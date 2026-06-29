# LoRaWAN Device Monitor — Backend

Lean ingest + read API for monitoring LoRaWAN devices on The Things Stack (TTS).
One process, one SQLite file (WAL), raw SQL — no ORM, no queue, no external services.

## Stack

- **Fastify** — HTTP server
- **better-sqlite3** — synchronous SQLite access
- **pino** — structured logging
- **@perseid/dev-kit** — build / lint / test tooling (matches the rest of the monorepo)

## Layout

```
src/scripts/
├── main.ts                 # entry: config → db → routes → listen
├── conf/
│   ├── config.ts           # env loading + validation
│   └── routes.ts           # route wiring
├── db/
│   ├── connection.ts       # open, pragmas, migration runner
│   ├── migrations/         # forward-only SQL, bundled as TS string constants
│   └── queries.ts          # ingest writes + retention deletes
├── webhooks/
│   ├── handler.ts          # secret validation + dispatch + route registration
│   ├── tts.ts              # TTS v3 payload types + extraction helpers
│   ├── uplink.ts | join.ts | downlink.ts   # per-event normalization + insert
├── api/
│   ├── health.ts | overview.ts | devices.ts | metrics.ts
│   ├── metricsEngine.ts    # shared time-series builder (device + fleet)
│   └── deviceMetrics.ts    # per-device summary computations
└── lib/
    ├── time.ts             # range parsing + bucket selection
    ├── metrics.ts          # packet loss, percentiles, inter-arrival
    ├── logger.ts           # pino factory
    └── retention.ts        # daily cleanup scheduler
```

## Run

```bash
yarn install
cp .env.example .env        # set WEBHOOK_SECRET at minimum
yarn dev                    # watch mode
yarn check                  # typecheck + lint
yarn build                  # bundle to dist/main.js
```

## Endpoints

Ingest (TTS-facing, require `X-TTS-Webhook-Secret`):
- `POST /webhooks/uplink` · `POST /webhooks/join` · `POST /webhooks/downlink`

Read API (behind your authenticating reverse proxy):
- `GET /api/health`
- `GET /api/overview`
- `GET /api/devices` — `?search= &sort=last_seen|loss_rate|rssi|name &limit= &offset=`
- `GET /api/devices/:dev_eui`
- `GET /api/devices/:dev_eui/uplinks|downlinks|joins` — `?from= &to= &limit=`
- `GET /api/devices/:dev_eui/metrics` — `?metric= &from= &to= &bucket=`
- `GET /api/metrics` — fleet-wide, same metrics
- `GET /api/joins` — recent fleet joins

`from`/`to` accept ISO 8601 or relative (`6h`, `24h`, `7d`, `30d`, `90d`, `180d`).
`bucket` is one of `5m,15m,1h,6h,1d,1w,1mo`; omit to auto-select by range.
Metrics: `uplink_count, packet_loss, n_b_trans, rssi, snr, sf_distribution, gateway_count, airtime, inter_arrival, downlink_success, active_devices`.

## Known TTS payload caveats

The standard TTS v3 **webhook** does not reliably include every field the spec's schema
lists. We normalize defensively and leave the following **nullable** rather than fabricate:

- `n_b_trans` (NbTrans), `adr`, `class_b` — part of device MAC state, generally absent from
  the uplink webhook. Columns exist; values stay `NULL` until a payload provides them. Metrics
  that depend on them (`n_b_trans`) simply skip NULLs.
- `confirmed` (uplink) — taken from `uplink_message.confirmed` when present.

`battery_pct` is best-effort: extracted from `decoded_payload` by probing common decoder
field names (`battery_pct`, `batteryLevel`, `battery`, `bat`, `soc`). `NULL` if not found.

## Behavior notes (deviations from the spec, by intent)

- **Unprocessable payloads return `400`, not `500`.** A payload missing required identifiers
  will never succeed on retry, so we don't ask TTS to retry it. Genuine errors (DB failure)
  still return `500`. The resulting `f_cnt` gap surfaces as packet loss, as intended.
- **Week/month buckets use fixed widths** (7d / 30d), not calendar boundaries, for stable
  index-based bucketing in both SQL and JS.
- **Time-series omit empty buckets** (only populated buckets are returned). Gap-filling, if
  wanted, is a frontend concern.
- **`silent_devices` per-bucket metric** is not implemented; the overview reports silent as
  `total_devices − active_devices_24h`.
- **Migrations are TS string constants**, not loose `.sql` files, so the esbuild single-file
  bundle stays self-contained.
