# Sharingan — NOC Specification

LoRaWAN network monitor. Lean, single-container, SQLite-backed. This document tracks the
current implementation and the planned Gateways (WMC) extension. It supersedes the original
"LoRaWAN Device Monitor" spec; deviations from that spec are called out inline.

---

## Part A — Implemented (current)

**Architecture.** One Docker container, one process, one SQLite (WAL) file. Fastify +
better-sqlite3 + raw SQL (built/linted/tested via `@perseid/dev-kit`). React + React Query +
uPlot SPA served as static assets by the backend with a SPA fallback. Deployed behind the
existing Traefik under the `/monitor` path prefix (stripPrefix), joined to `root_default`.

**Device ingest (push).** `POST /webhooks/{uplink,join,downlink}`, shared-secret header,
synchronous write. No TTS polling.

**Data model.** `devices`, `uplinks`, `uplink_gateways` (per-gateway RF per uplink),
`joins`, `downlinks` + indexes; forward-only TS-constant migrations.

**Read API.** `/api/health`, `/api/overview`, `/api/devices` (+ `/:id`, `/:id/uplinks`,
`/:id/downlinks`, `/:id/joins`, `/:id/metrics`, `/:id/events`, `/:id/export`),
`/api/metrics`, `/api/joins`, `/api/export` (multi-device).

**Metrics.** `uplink_count, packet_loss, n_b_trans, rssi, snr, sf_distribution,
gateway_count, airtime, inter_arrival, downlink_success, active_devices`; adaptive bucketing;
x-axis pinned to the selected range.

**Frontend.** Overview, Devices, Device-Detail (tabbed charts + event timeline + message
tables), Export (multi-device). Link-health alerts (⚠) from SNR margin over the SF demod
floor + RSSI bands. Slate / Sharingan theme toggle. Raw uplink export (JSON/CSV).

**Notable deviations from the original spec.** `@perseid/dev-kit` tooling + Fastify (not the
`@perseid/server` model layer); unprocessable webhooks → `400`; `n_b_trans/adr/class_b/
confirmed` nullable (absent from TTS webhooks); silent-device = `total − active_24h` (not the
3×median heuristic); fixed-width week/month buckets; `/monitor` path hosting.

---

## Part B — Gateways (WMC integration) — planned

### B.0 Premise
TTS provides **no gateway-specific uplink**. Gateway *traffic* is only observable indirectly,
via `uplink_gateways` (which gateways relayed each device uplink, with RSSI/SNR). Authoritative
gateway **state** (existence, location, connectivity, vitals, alerts) comes from **Kerlink
Wanesy Management Center (WMC)**. Sharingan therefore gains **three** gateway data channels:

1. **WMC poll (pull)** — periodic gateway list + status + location + vitals.
2. **WMC alerts webhook (push)** — WMC pushes gateway alerts in near-real-time *(to explore)*.
3. **`uplink_gateways` (push, already captured)** — observed traffic/RF per gateway EUI.

Joined on `gw_eui`, these answer both "is the gateway healthy?" (WMC) and "is it actually
carrying traffic?" (uplinks) — including the key anomaly **WMC=Operational but 0 uplinks heard**.

### B.1 WMC API
Base `{WMC_BASE_URL}/api/v1`. **Auth:** `POST /users/token` (HTTP Basic `WMC_LOGIN:WMC_PASSWORD`)
→ `{ data: { AccessToken } }` (Cognito JWT); accessible customer IDs read from the
`cognito:groups` claim (`WMP4:CUSTOMER:<id>:`). Subsequent calls use `Bearer`; `401` → re-login.

Endpoints used:
- `GET /customers/{customer_id}/gateways?offset=&limit=&q=&order_by=` → `{ data: [GatewayStatusModel], metadata: { offset, limit, totalCount } }`. `GatewayStatusModel`: `gwEui`, `name`, `customerId`, `creationDate`, `groups`, `connectionStatus { status ∈ Operational|Warning|Unreachable|Unknown, lastUpdateTime, messageInterval }`, `locations[] { latitude, longitude, location_type }`.
- `GET /customers/{id}/gateways/{eui}/health` → `{ vitals: [{ name, value, date }] }` (per-gateway vitals for the detail page).
- `PUT /customers/{id}/gateways/{eui}/location` → **write** a gateway's location (used by the deployment-address sync, §B.4).
- `GET /customers/{id}/gateways/{eui}/alerts`, `POST /customers/{id}/groups/{group_id}/alerts/webhook` → alerts read + outbound-webhook configuration (§B.3).

### B.2 `gateways` table
WMC-sourced fields are refreshed by the poller; **NOC-owned** fields (`site_name`,
`deployment_address`, `deployment_*`) are never overwritten by the poll.
```
gw_eui              TEXT PRIMARY KEY     -- uppercase hex
name                TEXT                 -- WMC
customer_id         INTEGER              -- WMC
status              TEXT                 -- WMC: Operational|Warning|Unreachable|Unknown
message_interval    INTEGER              -- WMC expected s between messages
last_status_at      TEXT                 -- WMC connectionStatus.lastUpdateTime
wmc_latitude        REAL                 -- WMC location
wmc_longitude       REAL                 -- WMC location
created_at          TEXT                 -- WMC creationDate
last_polled_at      TEXT
-- NOC-owned (operator-editable, §B.4)
site_name           TEXT
deployment_address  TEXT
deployment_lat      REAL                 -- geocoded or manual; preferred for the map
deployment_lng      REAL
notes               TEXT
updated_by_noc_at   TEXT
```

### B.3 WMC alerts (to explore)
WMC supports outbound alert webhooks (`.../groups/{group_id}/alerts/webhook`). Plan:
- New ingest endpoint **`POST /webhooks/wmc/alerts`** (shared secret), storing into a
  `gateway_alerts` table (`gw_eui`, `alert_type`, `severity`, `raised_at`, `cleared_at`,
  `raw` JSON, `acknowledged`).
- Surface alerts as gateway badges/feed on the NOC; map markers reflect active alerts.
- Fallback if push isn't viable: poll `/gateways/{eui}/alerts`.
- **Open:** confirm WMC's outbound alert webhook payload shape + auth header options before
  committing the parser.

### B.4 Deployment address (NOC → map → WMC)
Operators can set a **deployment address** (+ site name, notes) per gateway in the NOC. This:
- **Localizes the gateway** on the map and in lists — especially when WMC has no coordinates.
  An address is geocoded to `deployment_lat/lng` (geocoder TBD — external, e.g. Nominatim;
  manual lat/lng entry also allowed). The map prefers `deployment_*`, falling back to WMC.
- **Helps field response** — when a gateway shows an issue, the NOC shows where it physically
  is and who/where to dispatch.
- **Syncs to WMC** — a "push to WMC" action writes the location via
  `PUT /customers/{id}/gateways/{eui}/location`, keeping WMC's records current from the NOC.
- API: `PUT /api/gateways/:gw_eui` (set NOC fields), `POST /api/gateways/:gw_eui/sync-location`
  (push to WMC).
- **Open:** geocoder choice (external dependency / rate limits) vs. manual-coords-only first.

### B.5 Poller
In-process scheduler (same pattern as retention). Every `WMC_POLL_INTERVAL_SEC` (default 300),
per customer ID, page `GET /customers/{id}/gateways` and upsert WMC fields (leaving NOC fields
intact). Vitals fetched on-demand for the detail page. Skipped entirely if WMC env is unset
(gateways then come only from observed `uplink_gateways`).

### B.6 Read API
- `GET /api/gateways` — list: status, location (deployment→WMC), last seen, + observed 24h
  traffic (uplinks relayed, distinct devices heard, avg RSSI/SNR), active alert count.
- `GET /api/gateways/:gw_eui` — WMC metadata + vitals + NOC fields + observed traffic/RF series.
- `GET /api/gateways/:gw_eui/devices` — devices this gateway has heard.
- `PUT /api/gateways/:gw_eui`, `POST /api/gateways/:gw_eui/sync-location` (§B.4).

### B.7 Frontend
- **Gateways page**: Leaflet + OSM map (markers colored by status/alert, sized by traffic;
  popup → detail) **and** a table (status, EUI, name, site, last seen, uplinks 24h, devices
  heard, avg RSSI, alerts). Gateways without coordinates appear in the table only.
- **Gateway detail**: status/vitals/location header, editable deployment address + "sync to
  WMC", traffic & RF charts (from `uplink_gateways`), devices-heard list, alert history.

### B.8 Config (additions)
`WMC_BASE_URL`, `WMC_LOGIN`, `WMC_PASSWORD`, `WMC_POLL_INTERVAL_SEC` (default 300),
`WMC_ALERTS_WEBHOOK_SECRET` (if push alerts adopted), `MAP_TILE_URL` (default OSM),
`GEOCODER_URL` (optional, for address → coords).

### B.9 Caveats
- A gateway WMC doesn't manage but that relays uplinks still appears (via `uplink_gateways`)
  with traffic/RF but no WMC status/location.
- Map tiles are an **external, client-side** dependency (OSM) — the one relaxation of the
  "no external dependencies" rule; `MAP_TILE_URL` is configurable for self-hosting.
- Polling + WMC credentials are the first pull integration; framed as **devices = push,
  gateways = pull (+ optional WMC alert push)**.
