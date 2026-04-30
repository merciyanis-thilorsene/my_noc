# LoRaWAN NOC Backend — Technical Specification

## 1. Purpose

A backend system that aggregates real-time LoRaWAN telemetry from The Things Stack (TTS) and gateway infrastructure data from Kerlink Wanesy Management Center (WMC), exposing a unified API and real-time event stream to a NOC dashboard frontend. Designed to support future machine learning workloads (forecasting, anomaly detection, network optimization) through a clean architectural boundary.

---

## 2. Architecture Overview

The system is split into two services from day one, even though only the first is implemented initially:

**Service A — NOC Core (Perseid, implemented now)**
Handles all ingestion, registry, API, and real-time streaming. Owns write access to telemetry tables.

**Service B — ML Inference (FastAPI, added later)**
Handles forecasting, anomaly detection, and model training. Read-only access to telemetry tables; writes to dedicated ML tables.

```
                      ┌──────────────────────────────────────────┐
                      │              NOC Dashboard                │
                      │           (React frontend)                │
                      └───────────────────┬──────────────────────┘
                                          │
                         REST API + WebSocket (authenticated)
                                          │
                      ┌───────────────────▼──────────────────────┐
                      │       NOC Core Service (Perseid)          │
                      │  - Webhook receiver                       │
                      │  - TTS/WMC REST pollers                   │
                      │  - API endpoints + WebSocket              │
                      │  - Alert engine                           │
                      │  - Calls ML service when predictions      │
                      │    are requested (synchronous)            │
                      └──┬───────────────┬───────────────────┬───┘
                         │               │                   │
          ┌──────────────▼────┐  ┌───────▼────────┐  ┌───────▼────────┐
          │   TimescaleDB     │  │     Redis      │  │   ML Service    │
          │ (shared, versioned│  │ (cache + job   │  │   (FastAPI,     │
          │  schema contract) │  │   queue)       │  │   added later)  │
          └────────▲──────────┘  └────────────────┘  └────────┬───────┘
                   │                                          │
                   └──────────────── reads ───────────────────┘
                                      writes to ml_* tables
```

**Communication between services:** Synchronous HTTP for on-demand inference (dashboard asks for "forecast uplinks for gateway X"). Asynchronous via shared database and job queue for batch work (nightly retraining, fleet-wide anomaly scoring).

---

## 3. Service A — NOC Core (Perseid)

### 3.1 Data Ingestion

#### 3.1.1 TTS Webhook Receiver

One HTTPS endpoint receives all TTS event types. Authentication via shared secret header, validated on every request. Must return 200 OK within 5 seconds or TTS will retry.

Supported event types: `uplink_message`, `join_accept`, `downlink_ack`, `downlink_nack`, `downlink_failed`, `downlink_queued`, `downlink_sent`, `location_solved`.

On receipt: parse payload, normalize to canonical schema (see section 4.3), write to TimescaleDB via connection pool, emit internal event for WebSocket fanout and alert engine. Failed writes go to a dead-letter queue for replay.

Provides a health endpoint (`GET /webhook/health`) that TTS can hit to confirm reachability.

#### 3.1.2 TTS REST Poller

Background job running at configurable interval (default 5 minutes). Uses TTS Personal API Key.

Fetches:
- Gateway list with connection stats (`/api/v3/gateways` + `/api/v3/gs/gateways/{id}/connection/stats`)
- Application list (`/api/v3/applications`)
- Device list per configured application (`/api/v3/applications/{app_id}/devices`)

Results cached in Redis with TTL matching poll interval. On auth errors, logs and continues — registry is not critical-path.

#### 3.1.3 WMC REST Poller

Background job running at configurable interval (default 2 minutes). Handles JWT lifecycle: login on startup, refresh on 401 responses.

Fetches: gateway list with full KPI set via `/gms/application/gateways`. Extracts connection status, CPU, RAM, temperature, ping RTT, firmware version, backhaul type, uptime.

Writes KPI snapshots to `gateway_kpis` time-series table. Also updates the registry cache in Redis.

### 3.2 API Surface (Dashboard-Facing)

All endpoints return JSON, authenticated with a frontend API key separate from TTS/WMC credentials.

**Overview & Health**
- `GET /api/overview` — fleet-wide KPIs for dashboard landing page
- `GET /api/health` — service health including TTS/WMC connectivity status

**Gateways**
- `GET /api/gateways` — unified gateway fleet, merged TTS + WMC on EUI. Query params: `status`, `sort`
- `GET /api/gateways/:eui` — single gateway detail with recent metrics
- `GET /api/gateways/:eui/metrics?from&to&resolution` — time-series for a gateway (uplinks/h, RSSI histogram, CPU/RAM/temp history)

**Devices**
- `GET /api/devices?app_id=&filter=` — device fleet with computed metrics. Filters: `active`, `inactive`, `low_battery`, `poor_signal`, `silent`
- `GET /api/devices/:dev_eui` — single device detail with last N uplinks and full RF metadata
- `GET /api/devices/:dev_eui/uplinks?from&to&limit` — historical uplink stream for drill-down and charts

**Alerts**
- `GET /api/alerts?status=active&severity=` — alerts with filters
- `GET /api/alerts/history?from&to` — historical alert log

**Predictions (Phase 2 — proxies to ML service)**
- `GET /api/predictions/gateways/:eui/traffic?horizon=24h` — forecasted uplink volume
- `GET /api/predictions/devices/:dev_eui/battery?horizon=30d` — battery life estimate
- `GET /api/predictions/devices/:dev_eui/anomaly-score` — current anomaly score

**Real-Time Stream**
- `WS /ws/live` — WebSocket pushing events: `gateway_status_change`, `device_uplink`, `alert_raised`, `alert_cleared`. Authenticated via query-param token at connection handshake.

### 3.3 Alert Engine

Rules-based evaluator running on each new uplink and on each WMC poll cycle. Configurable thresholds in config or DB table.

**Minimum rule set:**

*Gateway alerts*
- Gateway down: no uplinks forwarded in X minutes while WMC reports OPERATIONAL (indicates LoRa concentrator failure)
- Gateway unreachable: WMC status UNREACHABLE for more than Y minutes
- Gateway high temperature: above threshold
- Gateway high ping: RTT above threshold
- Gateway high CPU/RAM: above threshold for sustained period

*Device alerts*
- Device silent: no uplink for N × expected_interval
- Device low battery: below threshold percentage
- Device poor signal: avg RSSI below threshold over last M uplinks
- Device frame counter reset: f_cnt_up drops significantly (possible ABP issue or replay attack)

*Network alerts*
- High network packet loss: percentage of expected uplinks missing across fleet
- Gateway diversity collapse: significant drop in avg gateways-per-uplink (indicates coverage degradation)

**Alert lifecycle:** each alert has `severity` (info/warning/critical), `source` (TTS/WMC/derived/ML), `entity` (gateway_eui or device_eui), `message`, `raised_at`, `cleared_at`. Alerts auto-clear when the condition resolves. History retained for audit.

### 3.4 Background Jobs

- **TTS poller** — every 5 min (configurable)
- **WMC poller** — every 2 min (configurable)
- **Alert evaluator** — every 1 min
- **Continuous aggregates refresh** — every 1 min (maintains `device_metrics_1m`, `gateway_metrics_1m`)
- **Data retention** — daily cleanup of data past retention window
- **ML feature cache refresh** (Phase 2) — refreshes Redis-cached features consumed by ML service for low-latency inference

---

## 4. Shared Data Layer (Contract Between Services)

This is the critical boundary. Both services read this schema; only NOC Core writes to non-ML tables.

### 4.1 Time-Series Tables (TimescaleDB)

**`uplinks`** — one row per received uplink (owned by: NOC Core)
Fields: `timestamp`, `device_eui`, `dev_addr`, `app_id`, `device_id`, `f_cnt_up`, `f_port`, `sf`, `data_rate`, `frequency`, `consumed_airtime_s`, `decoded_payload` (JSONB), `best_rssi`, `best_snr`, `gateway_count`, `raw_payload_b64`.
Indexed on `(device_eui, timestamp DESC)`, `(app_id, timestamp DESC)`.
Retention: 90 days hot, compressed after 7 days.

**`uplink_gateways`** — one row per gateway that received each uplink (owned by: NOC Core)
Fields: `timestamp`, `uplink_id`, `gateway_eui`, `gateway_id`, `rssi`, `snr`, `channel_index`, `channel_rssi`.
Indexed on `(gateway_eui, timestamp DESC)`, `(uplink_id)`.
Retention: 30 days.

**`gateway_kpis`** — infrastructure metrics from WMC (owned by: NOC Core)
Fields: `timestamp`, `gateway_eui`, `connection_status`, `cpu_pct`, `ram_pct`, `temperature_c`, `ping_rtt_ms`, `backhaul_type`.
Indexed on `(gateway_eui, timestamp DESC)`.
Retention: 30 days, compressed after 24h.

**`device_events`** — joins, downlinks, failures, queue invalidations (owned by: NOC Core)
Fields: `timestamp`, `device_eui`, `event_type`, `details` (JSONB).
Retention: 90 days.

**`alerts`** — alert history (owned by: NOC Core)
Fields: `id`, `severity`, `source`, `entity_type`, `entity_id`, `rule_name`, `message`, `raised_at`, `cleared_at`, `details` (JSONB).

### 4.2 ML Tables (Phase 2)

**`ml_predictions`** — forecast outputs (owned by: ML Service)
Fields: `timestamp`, `entity_type` (gateway/device), `entity_id`, `prediction_type` (traffic/battery/anomaly), `horizon_seconds`, `predicted_value` (JSONB), `confidence_interval` (JSONB), `model_version`.

**`ml_anomaly_scores`** — per-uplink anomaly scores (owned by: ML Service)
Fields: `timestamp`, `device_eui`, `uplink_timestamp`, `score`, `model_version`, `features_used` (JSONB).

**`ml_model_versions`** — registry of trained models (owned by: ML Service)
Fields: `version`, `model_type`, `trained_at`, `training_data_range`, `metrics` (JSONB), `artifact_path`.

### 4.3 Canonical Payload Schema (Normalization Contract)

NOC Core normalizes all TTS webhook payloads into a stable internal schema before writing. This decouples storage from TTS version quirks and ensures the ML service doesn't need to handle TTS-specific edge cases.

The schema is versioned and documented in a dedicated JSON Schema file (`/schemas/uplink-v1.json`) that lives in the repository. Any change is a breaking change requiring schema migration and coordinated update of both services.

**Key normalization rules:**
- All timestamps stored in UTC, ISO 8601 with microsecond precision
- RSSI/SNR as floats in dBm/dB (never strings)
- Spreading factor as integer 7–12 (parsed from `data_rate_index` or `SF{n}BW{m}` strings)
- Missing optional fields stored as NULL, never as empty strings or zeros
- JSONB `decoded_payload` preserves the TTS payload formatter output as-is
- Gateway EUIs uppercase hex, no separators

### 4.4 ML-Friendly Design Principles

The schema is designed for future ML consumption without requiring restructuring:

- **Flat wide tables** for time-series — minimize joins during training data extraction
- **Native Postgres/Timescale types** (no custom types) for direct pandas/Polars ingestion via `read_sql`
- **Timestamps always UTC** with timezone awareness
- **Feature-ready columns**: numeric metrics as floats/ints, categorical as text with bounded cardinality
- **Continuous aggregates** (`device_metrics_1m`, `gateway_metrics_1m`) provide pre-computed features at minute resolution, reducing ML feature-engineering cost
- **Retention policies** aligned with typical ML training windows (30–90 days of fine-grained data)

### 4.5 Registry Cache (Redis)

Last-known-state snapshots of slow-changing data. Keyed by EUI.
- `gateway:registry:{eui}` — identity, location, model, firmware, frequency plan
- `device:registry:{eui}` — identity, description, model, device class, LoRaWAN version, attributes
- `app:{id}` — application metadata

TTL: 2× the poll interval that refreshes them. Both services read from this cache; only NOC Core writes.

---

## 5. Service B — ML Inference Service (FastAPI, Phase 2)

### 5.1 Scope

Not implemented now. Spec included here so Phase 1 decisions don't create rework.

**Responsibilities:**
- On-demand inference (forecasts, anomaly scores)
- Scheduled batch scoring (nightly fleet-wide anomaly detection)
- Model training and retraining
- Model versioning and rollback

**Explicitly not responsible for:**
- Receiving webhooks (NOC Core does this)
- Serving the dashboard (NOC Core proxies ML calls)
- Writing to non-ML tables (read-only elsewhere)

### 5.2 API Surface (Internal, called by NOC Core)

- `POST /ml/forecast/traffic` — input: gateway_eui, horizon. Output: time-series forecast with confidence intervals
- `POST /ml/forecast/battery` — input: device_eui, horizon. Output: predicted remaining life
- `POST /ml/anomaly/score` — input: device_eui or uplink payload. Output: anomaly score 0–1
- `POST /ml/optimize/sf` — input: device_eui or list. Output: recommended SF allocation
- `GET /ml/models` — list available models and versions
- `GET /ml/health` — service health + loaded model status

### 5.3 Initial Model Set

- **Traffic forecasting**: Prophet or NeuralProphet for per-gateway uplink volume prediction
- **Battery forecasting**: linear/polynomial regression on historical battery decay, per device model
- **Anomaly detection**: Isolation Forest on uplink features (RSSI, SNR, SF, inter-arrival time, payload size), trained per device class
- **SF optimization** (later): reinforcement learning or rule-based optimizer using historical coverage data

### 5.4 Training Pipeline

- Scheduled training jobs via Celery or ARQ
- Reads training data directly from TimescaleDB using pandas/Polars
- Models stored in a dedicated object store (S3, MinIO, or local volume) with version metadata in `ml_model_versions`
- Blue/green model deployment: new version loaded in parallel, validated, then switched atomically

### 5.5 Inter-Service Contract

NOC Core calls ML service over HTTP with mTLS or shared secret. Timeouts: 2s for inference calls (if exceeded, NOC Core returns cached prediction or null with a flag). ML service responses cached in Redis with short TTL (30s–5min depending on prediction type) to avoid repeated calls for the same dashboard view.

---

## 6. Configuration

Environment variables or config file. Same keys usable across both services for shared resources.

**Shared:**
- `DATABASE_URL` — TimescaleDB connection string
- `REDIS_URL` — Redis connection string
- `LOG_LEVEL`, `ENV` (dev/staging/prod)

**NOC Core specific:**
- `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_APP_IDS` (comma-separated)
- `TTS_WEBHOOK_SECRET`
- `WMC_BASE_URL`, `WMC_LOGIN`, `WMC_PASSWORD`
- `TTS_POLL_INTERVAL_SEC`, `WMC_POLL_INTERVAL_SEC`
- `ALERT_THRESHOLDS_PATH` — path to YAML/JSON alert rules file
- `FRONTEND_API_KEYS` — comma-separated keys for dashboard auth
- `CORS_ORIGINS`
- `ML_SERVICE_URL` (Phase 2)

**ML Service specific (Phase 2):**
- `MODEL_STORE_PATH` or `S3_BUCKET`
- `TRAINING_SCHEDULE_CRON`

---

## 7. Operational Concerns

**Logging:** Structured JSON logs with correlation IDs that flow from webhook receipt through DB write through any ML call. Both services log in the same format for unified aggregation.

**Metrics:** Prometheus endpoint on both services exposing:
- Webhook receive rate and processing latency (NOC Core)
- TTS/WMC poll success/failure counts (NOC Core)
- DB write rate and latency (NOC Core)
- Active WebSocket connections (NOC Core)
- Alert counts by severity (NOC Core)
- Inference call rate and latency (ML Service, Phase 2)
- Model prediction accuracy over time (ML Service, Phase 2)

**Tracing:** OpenTelemetry traces with context propagation across service boundaries.

**Deployment:** Docker-based, with `docker-compose.yml` for local dev including TimescaleDB + Redis. Each service has its own image and can be scaled independently.

**Graceful shutdown:** Drain in-flight webhook requests, close DB connections, disconnect WebSocket clients cleanly.

**Auth:** API keys on all dashboard-facing endpoints. mTLS or shared secret on service-to-service calls. No public access to either service.

---

## 8. Non-Goals

Explicitly out of scope:
- Device downlink scheduling (use TTS directly)
- Device provisioning and registration (use TTS Console or CLI)
- Gateway firmware management (use WMC directly)
- Multi-tenancy (single organization scope)
- User management beyond API keys
- Payload formatter logic (trust TTS `decoded_payload`)

---

## 9. Success Criteria

- Webhook-to-dashboard latency under 2 seconds for 95% of events
- NOC Core handles 100 uplinks/second sustained without queue buildup
- TTS or WMC outage does not crash the service — degraded mode with stale-data indicators
- Dashboard receives updates via WebSocket without polling
- All RF and infrastructure metrics visible in the dashboard prototype backed by real data
- Phase 2 ML service can be added without schema migration of existing tables
- ML service can train on 90 days of historical data and produce forecasts within 2 seconds for on-demand calls

---

## 10. Phase Roadmap

**Phase 1 (now):** NOC Core only. Full ingestion, API, WebSocket, alerts. Simulated predictions returned with `"ml_service_not_deployed": true` flag where the ML endpoints would eventually live — keeps the dashboard contract stable.

**Phase 2 (ML addition):** FastAPI service deployed alongside. Reads from same TimescaleDB. NOC Core's `/api/predictions/*` endpoints switch from stubs to real proxies. No changes needed in the dashboard.

**Phase 3 (optimization features):** ML service gains write capability for recommendations (e.g., suggested SF changes). NOC Core exposes these via a new `/api/recommendations` endpoint. Operators review before applying.
