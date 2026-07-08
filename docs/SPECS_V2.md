# Sharingan — NOC Specification

LoRaWAN network monitor. Lean, single-container, SQLite-backed. This document tracks the
current implementation and the planned Gateways (WMC) extension. It supersedes the original
"LoRaWAN Device Monitor" spec; deviations from that spec are called out inline.

> **Revision note (Part B hardening).** This revision leaves **Part A unchanged** and hardens
> the planned Part B before it is built. Added: a foundational gateway-identity / `gw_eui`
> join-integrity section (new **§B.0.1**) that everything else depends on; a dedup uniqueness
> key for `gateway_alerts` (**§B.3**); a sync-to-WMC overwrite guard driven by WMC
> `location_type` (**§B.4**); poller write-path discipline and its interaction with the
> device-ingest idempotency constraint (**§B.5**); stale-gateway detection via
> `message_interval` (**§B.2 / §B.6**); `_FILE` secret support for `WMC_PASSWORD` /
> `WMC_ALERTS_WEBHOOK_SECRET` (**§B.8**); a sharpened definition of the
> "operational-but-silent" anomaly (**§B.0 / §B.9**); and a clarification that the alert
> webhook is **receive-only** — configured manually on WMC, with the NOC exposing just a
> receiving endpoint and never calling the WMC API to register it (**§B.1 / §B.3**). None of
> these change the three-channel architecture — they make it survive contact with real
> Kerlink/TTS data.

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
2. **WMC alerts webhook (push, configured on WMC)** — WMC pushes gateway alerts to a NOC
   receiving endpoint in near-real-time; the webhook is set up in the WMC console, not by the
   NOC *(to explore)*.
3. **`uplink_gateways` (push, already captured)** — observed traffic/RF per gateway EUI.

Joined on `gw_eui`, these answer both "is the gateway healthy?" (WMC) and "is it actually
carrying traffic?" (uplinks) — including the key anomaly **WMC=Operational but not carrying
the traffic it should**. See §B.0.1 for why the join is the load-bearing assumption of this
whole part, and §B.9 for why the *raw* "0 uplinks" form of the anomaly is not the actionable
one.

### B.0.1 Gateway identity & the `gw_eui` join (foundational — validate before building B.1–B.9)
Every cross-source view in Part B — the map, the "traffic vs. health" comparison, and above
all the operational-but-silent anomaly — is a **join on `gw_eui`** between WMC's `gwEui` and
`uplink_gateways.gateway_eui` (which TTS fills from `rx_metadata[].gateway_ids.eui`). These two
values come from **two independent systems** with no guarantee they are formatted, or even
derived, the same way. This is the single highest-risk assumption in Part B; treat it as a
prerequisite, not a detail.

- **Formatting divergence.** Case and separators can differ (`70:76:...` vs `7076...`,
  lower vs upper). **Requirement:** normalize `gw_eui` aggressively on both write paths —
  uppercase, strip all non-hex characters — exactly as Part A already does for DevEUI. Persist
  only the canonical form; join only on canonical form.
- **Kerlink derived-EUI trap.** On Kerlink hardware there is a well-known gap between the
  board/chip identifier and the **LoRaWAN gateway EUI**, the latter often built by inserting
  `FFFE` (or `FFFF`) in the middle of the MAC-derived value (an iFemtoCell EUI typically looks
  like `7076FF…FFFE`). If WMC surfaces one derivation and TTS the other, normalization alone
  will **not** reconcile them — the strings are genuinely different, not just differently
  punctuated. In that case a small **EUI-mapping table** (WMC EUI ↔ TTS EUI) is required; do
  not assume equality.
- **Failure mode if the join is wrong.** A broken join matches **zero** rows, which makes
  *every* WMC-Operational gateway look like it is hearing no traffic — the operational-but-
  silent anomaly fires as a **fleet-wide false positive**. This is the worst kind of bug: it
  looks like the feature is working (alerts everywhere), it is loud, and it trains the operator
  to distrust the signal. Silent under-counting (join partially matches) is nearly as bad.
- **Validation gate (hard prerequisite).** Before shipping any view that relies on the join —
  especially the anomaly — verify it against **real paired WMC + TTS data** for a handful of
  known gateways: confirm the same physical gateway resolves to the same canonical `gw_eui` on
  both sides. Do not enable the anomaly alert until this passes.
- **Nullability.** `uplink_gateways.gateway_eui` is nullable (Part A). Uplinks whose per-gateway
  EUI is absent join to nothing and are invisible to all gateway views. That is acceptable, but
  it means "uplinks relayed / devices heard" **under-counts** whenever the LNS omits the EUI —
  don't read a low count as a gateway problem without checking EUI presence first.

### B.1 WMC API
Base `{WMC_BASE_URL}/api/v1`. **Auth:** `POST /users/token` (HTTP Basic `WMC_LOGIN:WMC_PASSWORD`)
→ `{ data: { AccessToken } }` (Cognito JWT); accessible customer IDs read from the
`cognito:groups` claim (`WMP4:CUSTOMER:<id>:`). Subsequent calls use `Bearer`; `401` → re-login.

Endpoints used:
- `GET /customers/{customer_id}/gateways?offset=&limit=&q=&order_by=` → `{ data: [GatewayStatusModel], metadata: { offset, limit, totalCount } }`. `GatewayStatusModel`: `gwEui`, `name`, `customerId`, `creationDate`, `groups`, `connectionStatus { status ∈ Operational|Warning|Unreachable|Unknown, lastUpdateTime, messageInterval }`, `locations[] { latitude, longitude, location_type }`.
- `GET /customers/{id}/gateways/{eui}/health` → `{ vitals: [{ name, value, date }] }` (per-gateway vitals for the detail page).
- `PUT /customers/{id}/gateways/{eui}/location` → **write** a gateway's location (used by the deployment-address sync, §B.4). See the overwrite guard in §B.4 — this call writes into the authoritative system and must not clobber WMC-held GPS with a geocoded approximation.
- `GET /customers/{id}/gateways/{eui}/alerts` → alerts **read** — used only by the *optional* poll fallback (§B.3). **The NOC does not call WMC to register or configure the outbound alert webhook**; that is set up manually in the WMC console by the operator (§B.3). The NOC's only alert responsibility is exposing a receiving endpoint.

Note: `locations[].location_type` is not cosmetic — it distinguishes a surveyed/GPS coordinate
from a manually-entered one, and §B.4 depends on it to decide whether a NOC push is safe.

### B.2 `gateways` table
WMC-sourced fields are refreshed by the poller; **NOC-owned** fields (`site_name`,
`deployment_address`, `deployment_*`) are never overwritten by the poll.
```
gw_eui              TEXT PRIMARY KEY     -- canonical: uppercase hex, non-hex stripped (see B.0.1)
name                TEXT                 -- WMC
customer_id         INTEGER              -- WMC
status              TEXT                 -- WMC: Operational|Warning|Unreachable|Unknown
message_interval    INTEGER              -- WMC expected s between messages (drives stale detection, B.6)
last_status_at      TEXT                 -- WMC connectionStatus.lastUpdateTime
wmc_latitude        REAL                 -- WMC location
wmc_longitude       REAL                 -- WMC location
wmc_location_type   TEXT                 -- WMC locations[].location_type (GPS/surveyed vs manual) — needed by B.4 guard
created_at          TEXT                 -- WMC creationDate
last_polled_at      TEXT
-- NOC-owned (operator-editable, §B.4)
site_name           TEXT
deployment_address  TEXT
deployment_lat      REAL                 -- geocoded or manual; preferred for the map
deployment_lng      REAL
deployment_coord_source TEXT             -- 'manual' | 'geocoded' — B.4 uses this to decide sync safety
notes               TEXT
updated_by_noc_at   TEXT
```
`message_interval` + `last_status_at` are stored specifically so the NOC can compute its own
**stale** state (§B.6) rather than trusting only WMC's `status` enum — analogous to the
device-silence signal in Part A.

### B.3 WMC alerts (to explore)
Alert delivery is **push-only and configured entirely on the WMC side.** The operator sets up
WMC's outbound alert webhook (in the WMC console) to point at the NOC's receiving endpoint.
**The NOC never calls the WMC API to register or configure that webhook** — its sole
responsibility is to *receive*. Plan:
- New ingest endpoint **`POST /webhooks/wmc/alerts`** — the one and only NOC-side piece.
  Shared-secret header, verified with the same constant-time compare as the device webhooks.
  The secret is configured **on both ends manually**: entered in the WMC webhook setup and set
  in the NOC env (`WMC_ALERTS_WEBHOOK_SECRET`, §B.8) — the NOC does not exchange or provision
  it. Missing/mismatched secret → 401. On success, store into a `gateway_alerts` table
  (`gw_eui`, `alert_type`, `severity`, `raised_at`, `cleared_at`, `raw` JSON, `acknowledged`).
  Normalize `gw_eui` to canonical form on receipt (§B.0.1) so alerts join to gateways/uplinks.
- **Idempotency (commit this now, independent of the payload question).** `gateway_alerts`
  must carry a **uniqueness constraint on `(gw_eui, alert_type, raised_at)`** from day one,
  with insert-or-ignore semantics — for the same reason the device tables now dedup (see the
  device spec §3.7). Even push-only, WMC may re-deliver on its own retry, and the optional poll
  fallback below re-reads the same alerts; without the constraint each re-delivery duplicates.
  The constraint does not depend on the still-open payload shape, so it can be decided ahead of
  the parser. `cleared_at` and `acknowledged` are the mutable columns: on a matching key, update
  the existing row (set `cleared_at`, flip `acknowledged`) rather than inserting.
- Surface alerts as gateway badges/feed on the NOC; map markers reflect active alerts.
- **Optional** poll fallback, only if push proves unreliable: read `/gateways/{eui}/alerts`
  reusing the poller's existing WMC auth (§B.5) — note this is a plain *read*, not webhook
  configuration, so it doesn't contradict "config lives on WMC." Off by default; the receiving
  endpoint is the intended path. Relies on the dedup key above.
- **Open:** confirm WMC's outbound alert webhook **payload shape + auth header options** so the
  receiving endpoint can map fields correctly. This concerns only how `POST /webhooks/wmc/alerts`
  *parses* what WMC sends — not how the webhook is registered (that's manual, on WMC). The
  uniqueness key is already decided.

### B.4 Deployment address (NOC → map → WMC)
Operators can set a **deployment address** (+ site name, notes) per gateway in the NOC. This:
- **Localizes the gateway** on the map and in lists — especially when WMC has no coordinates.
  An address is geocoded to `deployment_lat/lng` (geocoder TBD — external, e.g. Nominatim;
  manual lat/lng entry also allowed). The map prefers `deployment_*`, falling back to WMC.
  Record whether the coordinate came from geocoding or manual entry in
  `deployment_coord_source` — the sync guard below needs it.
- **Helps field response** — when a gateway shows an issue, the NOC shows where it physically
  is and who/where to dispatch.
- **Syncs to WMC (guarded)** — a "push to WMC" action writes the location via
  `PUT /customers/{id}/gateways/{eui}/location`, keeping WMC's records current from the NOC.
  **This writes into the authoritative system, so it must not silently degrade good data.**
  Guard rule: consult WMC's current `location_type` (stored as `wmc_location_type`). If WMC
  already holds a **GPS/surveyed** coordinate and the NOC value is **geocoded** (a Nominatim
  street centroid is *not* the physical mount point — it can be tens of metres off), **do not
  overwrite**: either refuse the push with a clear warning, or require an explicit operator
  confirmation of the downgrade. Push freely when WMC has **no** coordinate, when the NOC value
  is **manual/surveyed**, or on explicit confirm. Never let an approximate geocode replace a
  known-good survey point without the operator knowingly choosing it.
- API: `PUT /api/gateways/:gw_eui` (set NOC fields), `POST /api/gateways/:gw_eui/sync-location`
  (push to WMC — applies the guard above; returns a clear "refused: WMC has GPS, NOC value is
  geocoded" style result the frontend can surface).
- **Open:** geocoder choice (external dependency / rate limits) vs. manual-coords-only first.

### B.5 Poller
In-process scheduler (same pattern as retention). Every `WMC_POLL_INTERVAL_SEC` (default 300),
per customer ID, page `GET /customers/{id}/gateways` and upsert WMC fields (leaving NOC fields
intact). Vitals fetched on-demand for the detail page. Skipped entirely if WMC env is unset
(gateways then come only from observed `uplink_gateways`).

**Write-path discipline (important — the poller is now a third writer).** The single SQLite
writer already serves webhook ingest **and** the retention sweep; the poller is the third
contender for the write lock. Two consequences:

- **It widens the retry window we just closed.** A bulk upsert of 50–200 gateways holds the
  write lock; during it, the **synchronous** webhook writes stall, the LNS's short webhook
  timeout can fire, and it retries. The device-ingest **idempotency constraint (device spec
  §3.7, dedup on retry)** is what keeps those retries from creating duplicate uplinks — so that
  constraint must be in place **before or with** this poller, not after. Part B makes the
  duplicate-delivery scenario *more* frequent, not less.
- **`better-sqlite3` is synchronous → protect the event loop.** A large upsert loop running
  synchronously inside the in-process scheduler blocks the **Node event loop**, which freezes
  *all* HTTP handling (reads included, not just writes) for the poll's duration. Keep poller
  transactions **short**: commit **per WMC page**, and **yield** (`setImmediate`/`await` a tick)
  between pages so the loop can serve requests. Do not wrap the whole multi-page poll in one
  transaction.

### B.6 Read API
- `GET /api/gateways` — list: status (including a NOC-derived **stale** flag from
  `last_status_at + message_interval × factor`, not just WMC's enum), location
  (deployment→WMC), last seen, + observed 24h traffic (uplinks relayed, distinct devices heard,
  avg RSSI/SNR), active alert count.
- `GET /api/gateways/:gw_eui` — WMC metadata + vitals + NOC fields + observed traffic/RF series.
- `GET /api/gateways/:gw_eui/devices` — devices this gateway has heard.
- `PUT /api/gateways/:gw_eui`, `POST /api/gateways/:gw_eui/sync-location` (§B.4, guarded).

### B.7 Frontend
- **Gateways page**: Leaflet + OSM map (markers colored by status/alert, sized by traffic;
  popup → detail) **and** a table (status, EUI, name, site, last seen, uplinks 24h, devices
  heard, avg RSSI, alerts). Gateways without coordinates appear in the table only.
- **Gateway detail**: status/vitals/location header, editable deployment address + "sync to
  WMC" (surfaces the §B.4 guard result if a push is refused/downgraded), traffic & RF charts
  (from `uplink_gateways`), devices-heard list, alert history.

### B.8 Config (additions)
`WMC_BASE_URL`, `WMC_LOGIN`, `WMC_PASSWORD`, `WMC_POLL_INTERVAL_SEC` (default 300),
`WMC_ALERTS_WEBHOOK_SECRET` (if push alerts adopted), `MAP_TILE_URL` (default OSM),
`GEOCODER_URL` (optional, for address → coords).

Secrets (`WMC_PASSWORD`, `WMC_ALERTS_WEBHOOK_SECRET`) must support the same **`_FILE`
path-to-secret** variant as every other secret in the deployment (Part A config convention),
so they can be mounted as container secrets rather than passed as plain env values.

### B.9 Caveats
- **The anomaly worth alerting on is not raw "0 uplinks."** A genuinely Operational gateway
  with no device currently in range legitimately hears nothing — flagging it is noise. The
  actionable signal is **"heard traffic before, then went silent while WMC still reports it
  up"** (a drop from a known baseline), not "has never relayed an uplink." Define the anomaly
  as a transition, and only after the §B.0.1 join has been validated on real data.
- A gateway WMC doesn't manage but that relays uplinks still appears (via `uplink_gateways`)
  with traffic/RF but no WMC status/location.
- **The `gw_eui` join is only as good as its validation.** Until §B.0.1 is verified against
  paired WMC+TTS data, treat every cross-source number (devices heard, uplinks relayed, the
  anomaly) as provisional. A zero is far more likely a join miss than a dead gateway.
- Map tiles are an **external, client-side** dependency (OSM) — the one relaxation of the
  "no external dependencies" rule; `MAP_TILE_URL` is configurable for self-hosting.
- Polling + WMC credentials are the first pull integration; framed as **devices = push,
  gateways = pull (+ optional WMC alert push)**.