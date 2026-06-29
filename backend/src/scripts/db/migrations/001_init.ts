/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Initial schema: device registry, uplinks (+ per-gateway RF), joins, downlinks, and the
 * indexes that keep dashboard queries off full-table scans across the retention window.
 */
export default `
CREATE TABLE devices (
  dev_eui         TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL,
  application_id  TEXT NOT NULL,
  join_eui        TEXT,
  name            TEXT,
  description     TEXT,
  device_class    TEXT,
  lorawan_version TEXT,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);

CREATE TABLE uplinks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp          TEXT NOT NULL,
  dev_eui            TEXT NOT NULL,
  device_id          TEXT NOT NULL,
  application_id     TEXT NOT NULL,
  f_cnt              INTEGER NOT NULL,
  f_port             INTEGER,
  frm_payload        TEXT,
  decoded_payload    TEXT,
  data_rate_index    INTEGER,
  sf                 INTEGER,
  bandwidth          INTEGER,
  coding_rate        TEXT,
  frequency          INTEGER,
  consumed_airtime_s REAL,
  confirmed          INTEGER,
  adr                INTEGER,
  class_b            INTEGER,
  n_b_trans          INTEGER,
  best_rssi          REAL,
  best_snr           REAL,
  gateway_count      INTEGER NOT NULL,
  received_at        TEXT NOT NULL,
  correlation_ids    TEXT
);

CREATE TABLE uplink_gateways (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uplink_id          INTEGER NOT NULL REFERENCES uplinks(id) ON DELETE CASCADE,
  gateway_eui        TEXT,
  gateway_id         TEXT,
  rssi               REAL,
  snr                REAL,
  channel_index      INTEGER,
  channel_rssi       REAL,
  timestamp          TEXT NOT NULL,
  location_latitude  REAL,
  location_longitude REAL
);

CREATE TABLE joins (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  dev_eui        TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  application_id TEXT NOT NULL,
  join_eui       TEXT,
  dev_addr       TEXT,
  received_at    TEXT NOT NULL
);

CREATE TABLE downlinks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  dev_eui        TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  application_id TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  f_port         INTEGER,
  confirmed      INTEGER,
  frm_payload    TEXT,
  session_key_id TEXT,
  correlation_ids TEXT,
  received_at    TEXT NOT NULL
);

CREATE INDEX idx_uplinks_dev_time ON uplinks(dev_eui, timestamp DESC);
CREATE INDEX idx_uplinks_time ON uplinks(timestamp DESC);
CREATE INDEX idx_uplinks_app_time ON uplinks(application_id, timestamp DESC);
CREATE INDEX idx_uplink_gateways_uplink ON uplink_gateways(uplink_id);
CREATE INDEX idx_uplink_gateways_gw_time ON uplink_gateways(gateway_eui, timestamp DESC);
CREATE INDEX idx_joins_dev_time ON joins(dev_eui, timestamp DESC);
CREATE INDEX idx_downlinks_dev_time ON downlinks(dev_eui, timestamp DESC);
CREATE INDEX idx_downlinks_corr ON downlinks(dev_eui, correlation_ids);
`;
