-- NOC Core — initial schema
-- Shared contract between NOC Core (writer) and future ML Service (reader).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =====================================================================
-- uplinks: one row per received LoRaWAN uplink
-- =====================================================================
CREATE TABLE IF NOT EXISTS uplinks (
  id                 bigserial,
  timestamp          timestamptz NOT NULL,
  device_eui         text NOT NULL,
  dev_addr           text,
  app_id             text,
  device_id          text,
  f_cnt_up           bigint,
  f_port             int,
  sf                 int,
  data_rate          text,
  frequency          double precision,
  consumed_airtime_s double precision,
  decoded_payload    jsonb,
  best_rssi          double precision,
  best_snr           double precision,
  gateway_count      int,
  raw_payload_b64    text,
  correlation_id     text,
  PRIMARY KEY (timestamp, id)
);
SELECT create_hypertable('uplinks', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS uplinks_device_time_idx ON uplinks (device_eui, timestamp DESC);
CREATE INDEX IF NOT EXISTS uplinks_app_time_idx    ON uplinks (app_id,     timestamp DESC);

-- =====================================================================
-- uplink_gateways: one row per gateway that received each uplink
-- =====================================================================
CREATE TABLE IF NOT EXISTS uplink_gateways (
  timestamp     timestamptz NOT NULL,
  uplink_id     bigint NOT NULL,
  gateway_eui   text NOT NULL,
  gateway_id    text,
  rssi          double precision,
  snr           double precision,
  channel_index int,
  channel_rssi  double precision,
  PRIMARY KEY (timestamp, uplink_id, gateway_eui)
);
SELECT create_hypertable('uplink_gateways', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS uplink_gateways_gateway_time_idx ON uplink_gateways (gateway_eui, timestamp DESC);
CREATE INDEX IF NOT EXISTS uplink_gateways_uplink_idx       ON uplink_gateways (uplink_id);

-- =====================================================================
-- gateway_kpis: WMC infrastructure metrics per gateway
-- =====================================================================
CREATE TABLE IF NOT EXISTS gateway_kpis (
  timestamp         timestamptz NOT NULL,
  gateway_eui       text NOT NULL,
  connection_status text,
  cpu_pct           double precision,
  ram_pct           double precision,
  temperature_c     double precision,
  ping_rtt_ms       double precision,
  backhaul_type     text,
  firmware_version  text,
  uptime_s          bigint,
  PRIMARY KEY (timestamp, gateway_eui)
);
SELECT create_hypertable('gateway_kpis', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS gateway_kpis_gateway_time_idx ON gateway_kpis (gateway_eui, timestamp DESC);

-- =====================================================================
-- device_events: joins, downlinks, failures, queue invalidations
-- =====================================================================
CREATE TABLE IF NOT EXISTS device_events (
  timestamp  timestamptz NOT NULL,
  device_eui text NOT NULL,
  event_type text NOT NULL,
  details    jsonb,
  PRIMARY KEY (timestamp, device_eui, event_type)
);
SELECT create_hypertable('device_events', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS device_events_device_time_idx ON device_events (device_eui, timestamp DESC);

-- =====================================================================
-- alerts: alert history and currently-active alerts
-- =====================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id          bigserial PRIMARY KEY,
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source      text NOT NULL CHECK (source IN ('TTS', 'WMC', 'DERIVED', 'ML')),
  entity_type text NOT NULL CHECK (entity_type IN ('gateway', 'device', 'network')),
  entity_id   text NOT NULL,
  rule_name   text NOT NULL,
  message     text NOT NULL,
  raised_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz,
  details     jsonb
);
CREATE INDEX IF NOT EXISTS alerts_entity_idx  ON alerts (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS alerts_raised_idx  ON alerts (raised_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_active_uq
  ON alerts (entity_type, entity_id, rule_name)
  WHERE cleared_at IS NULL;

-- =====================================================================
-- Compression and retention policies
-- =====================================================================
ALTER TABLE uplinks         SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_eui');
ALTER TABLE uplink_gateways SET (timescaledb.compress, timescaledb.compress_segmentby = 'gateway_eui');
ALTER TABLE gateway_kpis    SET (timescaledb.compress, timescaledb.compress_segmentby = 'gateway_eui');
ALTER TABLE device_events   SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_eui');

SELECT add_compression_policy('uplinks',         INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_compression_policy('uplink_gateways', INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_compression_policy('gateway_kpis',    INTERVAL '24 hours',if_not_exists => TRUE);
SELECT add_compression_policy('device_events',   INTERVAL '7 days',  if_not_exists => TRUE);

SELECT add_retention_policy('uplinks',         INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('uplink_gateways', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('gateway_kpis',    INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('device_events',   INTERVAL '90 days', if_not_exists => TRUE);

-- =====================================================================
-- Continuous aggregates: 1-minute buckets ready for ML feature extraction
-- =====================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS gateway_metrics_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', timestamp) AS bucket,
  gateway_eui,
  avg(cpu_pct)         AS cpu_pct_avg,
  max(cpu_pct)         AS cpu_pct_max,
  avg(ram_pct)         AS ram_pct_avg,
  avg(temperature_c)   AS temperature_c_avg,
  max(temperature_c)   AS temperature_c_max,
  avg(ping_rtt_ms)     AS ping_rtt_ms_avg,
  max(ping_rtt_ms)     AS ping_rtt_ms_max,
  last(connection_status, timestamp) AS connection_status
FROM gateway_kpis
GROUP BY bucket, gateway_eui
WITH NO DATA;

SELECT add_continuous_aggregate_policy('gateway_metrics_1m',
  start_offset      => INTERVAL '2 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS device_metrics_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', timestamp) AS bucket,
  device_eui,
  count(*)                AS uplink_count,
  avg(best_rssi)          AS rssi_avg,
  min(best_rssi)          AS rssi_min,
  avg(best_snr)           AS snr_avg,
  avg(gateway_count)      AS gateway_count_avg,
  max(f_cnt_up)           AS f_cnt_up_max,
  sum(consumed_airtime_s) AS airtime_s_sum
FROM uplinks
GROUP BY bucket, device_eui
WITH NO DATA;

SELECT add_continuous_aggregate_policy('device_metrics_1m',
  start_offset      => INTERVAL '2 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE);
