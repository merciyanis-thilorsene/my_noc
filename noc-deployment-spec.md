# LoRaWAN NOC — Deployment & Containerization Specification

## 1. Purpose

Defines how the LoRaWAN NOC system is packaged, deployed, and operated using Docker. Complements `noc-backend-spec.md` and `noc-frontend-spec.md` by specifying the runtime environment, networking, secrets, and operational patterns that span across all components.

This spec is the third pillar of the system design. The backend spec defines *what the services do*, the frontend spec defines *what the user sees*, and this spec defines *how it all runs*.

---

## 2. Deployment Topology

The full system is composed of five containers in Phase 1, six in Phase 2 when ML is added:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Docker Network (bridge)                       │
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Frontend    │    │  NOC Core    │    │  ML Service   │          │
│  │  (nginx)     │───▶│  (Perseid)   │◀──▶│  (FastAPI)    │          │
│  │              │    │              │    │  [Phase 2]    │          │
│  └──────────────┘    └──────┬───────┘    └──────┬───────┘          │
│         ▲                   │                    │                   │
│         │                   │                    │                   │
│         │            ┌──────▼──────┐     ┌──────▼──────┐           │
│         │            │ TimescaleDB │     │    Redis    │           │
│         │            │             │     │             │           │
│         │            └─────────────┘     └─────────────┘           │
└─────────┼─────────────────┬───────────────────────────────────────┘
          │                 │
   ┌──────▼──────┐          │
   │   Reverse   │          │  (TTS webhooks arrive here,
   │    Proxy    │◀─────────┘   routed to NOC Core)
   │  (Traefik/  │
   │   Caddy)    │
   └──────┬──────┘
          │
          │  HTTPS (port 443)
          │
     ┌────▼─────┐
     │ Internet │  (operators, TTS webhooks)
     └──────────┘
```

Single Docker host deployment is the default target for Phase 1. The architecture scales out cleanly if you later move to Docker Swarm, Nomad, or Kubernetes — each service is independently deployable, stateless (except the data tier), and communicates only through the API surface.

---

## 3. Container Inventory

### 3.1 Reverse Proxy

**Image:** Traefik (recommended) or Caddy. Both auto-provision Let's Encrypt certificates with minimal config. Traefik integrates natively with Docker labels for dynamic routing; Caddy has a simpler config file model. Pick based on team familiarity.

**Responsibilities:**
- TLS termination (Let's Encrypt or mounted certificates)
- HTTP → HTTPS redirect
- Route `/api/*` and `/ws/*` to NOC Core
- Route `/webhooks/tts` to NOC Core (separate path, rate-limited)
- Route everything else (`/`, `/static/*`, etc.) to Frontend
- Rate limiting on public endpoints (especially webhook to defend against abuse)
- Basic request logging in a consistent format

**Ports:** 80 (redirect), 443 (primary). These are the only ports exposed to the host network.

### 3.2 Frontend Container

**Image:** Multi-stage build — Node build stage produces static assets, nginx runtime stage serves them.

**Dockerfile pattern:**
```
Stage 1: node:20-alpine
  - Install dependencies
  - Run build (produces static bundle in /app/dist)

Stage 2: nginx:1-alpine
  - Copy /app/dist to /usr/share/nginx/html
  - Copy custom nginx.conf with SPA fallback (try_files $uri /index.html)
  - EXPOSE 80
```

**Runtime config injection:** Backend URL is injected at container start via a `config.js` file generated from environment variables, loaded before the app bundle. This lets the same built image point to different backends across environments (dev/staging/prod) without rebuilding.

**Resource footprint:** nginx serving static files — negligible. 64MB memory limit is generous.

### 3.3 NOC Core (Perseid) Container

**Image:** `node:20-alpine` base. Multi-stage build to exclude dev dependencies and source maps from the production image.

**Dockerfile pattern:**
```
Stage 1: build
  - Install all dependencies (including dev)
  - Run build / transpile

Stage 2: runtime
  - node:20-alpine
  - Copy package.json + lockfile, install production dependencies only
  - Copy built artifacts
  - Drop to non-root user
  - HEALTHCHECK: curl /api/health every 30s
  - CMD: node dist/server.js (or Perseid equivalent)
```

**Environment variables** (see backend spec section 6 for full list): DATABASE_URL, REDIS_URL, TTS_*, WMC_*, ML_SERVICE_URL, etc. All secrets injected via Docker secrets or an environment file; never baked into the image.

**Exposed port:** 3000 (internal only, not published to host). Reverse proxy reaches it over the Docker network.

**Resource footprint:** 256–512MB memory typical, scales with webhook traffic. CPU mostly idle outside bursts.

**Volumes:** None required. Service is stateless. Logs go to stdout (picked up by Docker logging driver).

### 3.4 ML Service (FastAPI) Container — Phase 2

**Image:** `python:3.12-slim` base. Multi-stage build if using compiled dependencies (NumPy, PyTorch).

**Dockerfile pattern:**
```
Stage 1: build
  - python:3.12 (full, not slim — has build tools)
  - Install requirements into a virtualenv at /opt/venv
  - Copy source

Stage 2: runtime
  - python:3.12-slim
  - Copy /opt/venv from build stage
  - Copy source
  - Non-root user
  - HEALTHCHECK: curl /ml/health
  - CMD: uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

**Environment variables:** DATABASE_URL (read-only user recommended), REDIS_URL, MODEL_STORE_PATH, TRAINING_SCHEDULE_CRON.

**Exposed port:** 8000 (internal only). NOC Core reaches it over the Docker network using the service name.

**Volumes:** `/models` mounted for model artifacts (could be a named volume, bind mount, or S3-backed in larger deployments).

**Resource footprint:** Highly variable. Inference-only: 512MB–1GB. With training jobs: 2–4GB RAM, and GPU if deep learning is used (requires NVIDIA Container Toolkit).

### 3.5 TimescaleDB Container

**Image:** `timescale/timescaledb:latest-pg16` (or pinned version).

**Volumes:** Named volume mounted at `/var/lib/postgresql/data`. This is where all time-series telemetry lives — back it up accordingly.

**Environment variables:** `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_USER`.

**Exposed port:** 5432 (internal only). Never publish to the host in production.

**Initialization:**
- `initdb.d` scripts create the hypertables, continuous aggregates, retention policies, and users (including a read-only user for ML service Phase 2)
- Alternatively, use a migration tool inside NOC Core on startup (recommended — versioned migrations in code, not scattered SQL files)

**Resource footprint:** Depends on data volume. 2–4GB memory for a fleet of ~100 gateways and ~5000 devices at 90-day retention. Tune `shared_buffers`, `work_mem`, `maintenance_work_mem` via a mounted postgresql.conf.

**Backup strategy:** Daily `pg_dump` to an off-container location (S3, mounted network drive, or backup host). Retention 30 days. Restoration tested quarterly.

### 3.6 Redis Container

**Image:** `redis:7-alpine`.

**Volumes:** Named volume at `/data` if persistence is desired (AOF or RDB). For registry cache only, persistence is optional — losing the cache just triggers a refresh poll.

**Configuration:** Mount a `redis.conf` to enable persistence, set maxmemory policy (`allkeys-lru` is sensible for a cache), and set a password.

**Exposed port:** 6379 (internal only).

**Resource footprint:** 128–256MB typically sufficient for registry cache + job queue.

---

## 4. Docker Compose (Phase 1)

A single `docker-compose.yml` defines the full stack. The deliverable should look roughly like this, with specifics filled in by Claude Code:

```yaml
version: '3.9'

services:
  proxy:
    image: traefik:v3
    ports: [80:80, 443:443]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./certs:/certs
    networks: [noc_net]

  frontend:
    build: ./frontend
    environment:
      - BACKEND_URL=https://noc.example.com
    labels:
      - traefik.http.routers.frontend.rule=Host(`noc.example.com`)
    networks: [noc_net]

  noc_core:
    build: ./noc-core
    env_file: ./secrets/noc-core.env
    depends_on: [timescaledb, redis]
    labels:
      - traefik.http.routers.api.rule=Host(`noc.example.com`) && PathPrefix(`/api`)
      - traefik.http.routers.ws.rule=Host(`noc.example.com`) && PathPrefix(`/ws`)
      - traefik.http.routers.webhook.rule=Host(`noc.example.com`) && PathPrefix(`/webhooks`)
    networks: [noc_net]
    restart: unless-stopped

  timescaledb:
    image: timescale/timescaledb:latest-pg16
    env_file: ./secrets/db.env
    volumes:
      - tsdb_data:/var/lib/postgresql/data
      - ./postgresql.conf:/etc/postgresql/postgresql.conf
    networks: [noc_net]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server /etc/redis.conf
    volumes:
      - redis_data:/data
      - ./redis.conf:/etc/redis.conf
    networks: [noc_net]
    restart: unless-stopped

networks:
  noc_net:
    driver: bridge

volumes:
  tsdb_data:
  redis_data:
```

In Phase 2, an `ml_service` block is added with its own build context, env file, and a model artifacts volume. NOC Core's env file gains `ML_SERVICE_URL=http://ml_service:8000`.

---

## 5. Networking

### 5.1 Internal Network

All containers join a single Docker bridge network (`noc_net`). Services reach each other by container name as DNS:
- `http://noc_core:3000` from the reverse proxy
- `http://ml_service:8000` from NOC Core
- `postgresql://timescaledb:5432` from NOC Core and ML Service
- `redis://redis:6379` from NOC Core and ML Service

No service other than the reverse proxy publishes ports to the host network.

### 5.2 External Access

Only ports 80 and 443 on the host are exposed. Everything external (operators, TTS webhooks) enters through the reverse proxy.

Webhook endpoint is at a distinct path (`/webhooks/tts`) so you can apply stricter rate limiting, source IP restrictions (if TTS publishes IP ranges), and shared-secret validation at the proxy layer in addition to the backend.

### 5.3 TLS

Let's Encrypt via the reverse proxy is the simplest path. Requires the host to be reachable on ports 80 and 443 from the internet and a domain name pointing to it. Traefik handles cert provisioning and renewal automatically.

For air-gapped deployments or enterprise PKI, mount certificates as a volume and configure the proxy to use them.

---

## 6. Secrets Management

**Never commit secrets to the repository or bake them into images.**

**Phase 1 (single host):**
- `.env` files under `./secrets/` directory, gitignored
- Mounted into containers via `env_file` in docker-compose
- File permissions set to 600, owned by the deployment user

**Phase 1+ (better hygiene):**
- Docker secrets (`docker-compose.yml` v3.1+) for sensitive values
- Values stored outside the repository — in a password manager, Vault, or cloud secrets manager

**Secrets that must be rotated periodically:**
- TTS API key
- WMC password
- Webhook shared secret
- Database passwords
- Frontend API keys

Document the rotation procedure in an operational runbook. Rotation should not require service rebuilds — secrets are injected at container start, so a restart picks up new values.

---

## 7. Configuration Management

### 7.1 Layered Configuration

- **Image-level defaults:** sane defaults baked in (poll intervals, log levels)
- **Environment variables:** deployment-specific overrides (URLs, credentials, resource limits)
- **Mounted config files:** complex configuration that doesn't fit in env vars (alert thresholds, postgresql.conf, redis.conf, custom nginx config)

### 7.2 Environment Parity

Three environments target the same compose structure:
- **Dev:** Local compose on developer laptop. SQLite or ephemeral TimescaleDB, simulated TTS/WMC, self-signed certs.
- **Staging:** Mirror of production with test-tenant credentials against TTS staging and a test WMC account.
- **Production:** Full system against production TTS and WMC.

Use different compose override files (`docker-compose.override.yml`, `docker-compose.prod.yml`) rather than duplicating the base file.

---

## 8. Logging

### 8.1 Output

All services log to stdout/stderr in structured JSON. No log files written inside containers (they'd be lost on restart).

### 8.2 Collection

**Phase 1 minimum:** Docker's default `json-file` logging driver with log rotation configured (`max-size: 100m, max-file: 5` per container).

**Recommended upgrade:** A log aggregation sidecar or driver sending to Loki, Elasticsearch, or a managed service. This is a big quality-of-life improvement — searching logs across services becomes one query instead of N `docker logs` commands.

### 8.3 Correlation IDs

Every request, webhook, and background job gets a correlation ID. It propagates through:
- HTTP headers on cross-service calls (`X-Correlation-ID`)
- Log fields (`correlation_id` in every log line)
- Database writes where relevant (e.g., a tracing column on the `uplinks` table could hold the webhook correlation ID)

This is what makes "why did this specific uplink not appear on the dashboard?" a tractable question six months from now.

---

## 9. Health Checks & Monitoring

### 9.1 Container Health Checks

Each service defines a `HEALTHCHECK` in its Dockerfile:
- Frontend: `wget -q -O /dev/null http://localhost/`
- NOC Core: `curl -f http://localhost:3000/api/health`
- ML Service: `curl -f http://localhost:8000/ml/health`
- TimescaleDB: `pg_isready -U $POSTGRES_USER`
- Redis: `redis-cli ping`

Reverse proxy only routes to healthy containers.

### 9.2 Metrics Endpoint

NOC Core and ML Service expose Prometheus-format metrics at `/metrics`. A Prometheus container can be added to the compose stack to scrape them, with Grafana for dashboards.

This is optional for Phase 1 but strongly recommended before the system hits production use — operational metrics are how you catch degradation before it becomes an outage.

### 9.3 Uptime Monitoring

External uptime check (Healthchecks.io, UptimeRobot, or similar) pinging `/api/health` every 5 minutes. Alerts to operators if three consecutive checks fail.

---

## 10. Data Persistence & Backup

### 10.1 What Persists

- `tsdb_data` volume — all telemetry and alerts
- `redis_data` volume — cache (optional to persist) and job queue (persist if jobs are critical)
- `ml_models` volume (Phase 2) — trained model artifacts
- `./secrets/` directory on host — configuration secrets

### 10.2 Backup Strategy

**TimescaleDB:**
- Daily `pg_dump` inside a cron container or host-level cron
- Compressed and uploaded to off-site storage (S3, B2, network drive)
- 30-day rolling retention
- Monthly full backup retained for 1 year

**Redis:**
- If persisted, AOF file backed up daily alongside the database

**Secrets:**
- Backed up separately, encrypted at rest, stored in a password manager or vault

### 10.3 Restore Testing

Quarterly drill: spin up a second stack on a separate host, restore from latest backup, verify the dashboard loads and recent data is present. Document the procedure and time-to-restore.

---

## 11. Deployment Procedure

### 11.1 Initial Deployment

1. Provision a host with Docker and Docker Compose installed
2. Clone the repository
3. Copy `secrets.example/` to `secrets/` and fill in actual values
4. Configure DNS to point the chosen domain at the host
5. Run `docker-compose up -d`
6. Watch logs until all services report healthy
7. Access the frontend URL, enter API key, verify connection

### 11.2 Updates

Each service has an independent release cycle. Updating one service:

```
docker-compose pull <service>         # if using pre-built images
# or
docker-compose build <service>        # if building from source

docker-compose up -d <service>        # rolling replace
```

For schema migrations (TimescaleDB), NOC Core runs migrations on startup. For backwards-incompatible migrations (rare), follow a blue/green pattern: new NOC Core version reads new schema, briefly tolerates old schema, old version is stopped only after new is confirmed healthy.

### 11.3 Rollback

Images are tagged with semantic versions plus git SHA. Rollback is:
```
docker-compose up -d --no-deps <service>:<previous-tag>
```

ML model rollback is separate: the model version registry in the database allows switching between versions without redeploying the ML service container.

---

## 12. Security

### 12.1 Image Hygiene

- Base images pinned to specific versions, not `latest`
- Scheduled rebuilds to pick up security patches (monthly minimum)
- Vulnerability scanning on push (Trivy, Grype, or registry-native scanning)
- No build tools, shells, or debug utilities in production images
- Non-root user in every container

### 12.2 Network Security

- No database or Redis ports published to host
- Reverse proxy handles all TLS; internal traffic over HTTP is acceptable on the private Docker network (though mTLS between services is a reasonable hardening step for Phase 2)
- Rate limits on public endpoints, especially webhook intake
- Webhook endpoint validates shared secret AND optionally source IP

### 12.3 Access Control

- SSH access to the host limited to ops team, key-based only
- Docker daemon socket not exposed over network
- Reverse proxy's dashboard (if Traefik) protected with basic auth or disabled in production

### 12.4 Audit Trail

- All alert events persisted (see backend spec)
- Reverse proxy access logs retained
- Config changes in version control where possible; secret changes logged in a separate access log

---

## 13. Resource Planning

### 13.1 Minimum Host Specifications

**Phase 1 (without ML):**
- 2 vCPU, 4GB RAM, 40GB disk
- Handles up to ~50 gateways and ~2000 devices comfortably

**Phase 1 (medium scale):**
- 4 vCPU, 8GB RAM, 100GB disk
- Handles ~200 gateways and ~10000 devices

**Phase 2 (with ML, no GPU):**
- 4 vCPU, 16GB RAM, 100GB disk
- Training jobs run in off-hours; inference is modest

**Phase 2 (with GPU for deep learning):**
- NVIDIA GPU with Container Toolkit
- Additional 8GB+ RAM for model loading
- Only if deep learning is chosen over classical ML; Prophet and Isolation Forest do not need GPU

### 13.2 Scaling Paths

**Vertical:** Most effective first step — bump the host size. Single-host compose goes a long way.

**Horizontal (within Compose):** Multiple replicas of NOC Core behind the reverse proxy. Requires sticky sessions or WebSocket-aware load balancing; Traefik supports this.

**Beyond Compose:** Move to Docker Swarm (minimal changes) or Kubernetes (more rework but standard). The service boundaries are already clean enough for either migration.

---

## 14. Local Development

A developer should be able to run the full stack locally with:

```
git clone <repo>
cp secrets.example/ secrets/   # fill in dev values
docker-compose up
```

Dev compose override includes:
- Volume mounts of source code for hot-reload (NOC Core, ML Service, Frontend)
- Dev dependencies included in images
- TimescaleDB exposed on localhost:5432 for direct access with psql
- Redis exposed on localhost:6379
- Self-signed certs or HTTP-only on localhost
- Optional simulated TTS/WMC endpoints (a tiny mock server container) for offline development

The goal: new team members productive in under an hour.

---

## 15. Open Deployment Questions

Decisions to resolve before Claude Code starts:

- **Target host:** Single VPS, on-premise server, or managed Docker-as-a-service? Affects backup strategy and network access
- **Domain & TLS:** Public internet with Let's Encrypt, or internal network with custom PKI?
- **Log aggregation:** Accept `docker logs` for Phase 1 or set up Loki/ELK from day one?
- **Monitoring stack:** Prometheus + Grafana co-deployed, or use an external service?
- **Backup destination:** S3-compatible object storage, NFS, or something else?
- **Image registry:** Public registry (Docker Hub), private (GitHub/GitLab Container Registry), or self-hosted?
- **CI/CD pipeline:** Build images in CI and deploy on push, or manually build on host?

---

## 16. Success Criteria

- Full stack comes up from `docker-compose up` with no manual intervention beyond filling in secrets
- Dashboard accessible via HTTPS with valid certificate within 2 minutes of initial deployment
- Single service can be updated, restarted, or rolled back without disrupting others
- Database and Redis data survive container restarts and recreations
- TTS webhooks reach NOC Core successfully through the reverse proxy
- System runs for 30+ days without manual intervention (modulo security patches)
- Backup restoration tested and documented; time-to-restore under 30 minutes
- ML service can be added in Phase 2 by adding one block to docker-compose.yml and one env var to NOC Core
