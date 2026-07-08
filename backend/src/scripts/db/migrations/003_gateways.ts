/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Gateway registry (WMC integration, Part B).
 *
 * `gateways` merges two sources keyed on the canonical `gw_eui`: WMC-sourced fields refreshed
 * by the poller, and NOC-owned fields (`site_name`, `deployment_*`, `notes`) an operator edits
 * and the poll never overwrites. `message_interval` + `last_status_at` are stored so the NOC can
 * derive its own stale state rather than trusting only WMC's `status` enum.
 *
 * `gateway_alerts` stores alerts pushed by WMC's outbound webhook (configured on the WMC side).
 * The uniqueness key `(gw_eui, alert_type, raised_at)` makes re-delivery — WMC's own retries, or
 * the optional poll fallback re-reading the same alerts — an update rather than a duplicate.
 */
export default `
CREATE TABLE gateways (
  gw_eui                  TEXT PRIMARY KEY,
  name                    TEXT,
  customer_id             INTEGER,
  status                  TEXT,
  message_interval        INTEGER,
  last_status_at          TEXT,
  wmc_latitude            REAL,
  wmc_longitude           REAL,
  wmc_location_type       TEXT,
  created_at              TEXT,
  last_polled_at          TEXT,
  site_name               TEXT,
  deployment_address      TEXT,
  deployment_lat          REAL,
  deployment_lng          REAL,
  deployment_coord_source TEXT,
  notes                   TEXT,
  updated_by_noc_at       TEXT
);

CREATE TABLE gateway_alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  gw_eui       TEXT NOT NULL,
  alert_type   TEXT NOT NULL,
  severity     TEXT,
  raised_at    TEXT NOT NULL,
  cleared_at   TEXT,
  raw          TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_gateway_alerts_dedup ON gateway_alerts(gw_eui, alert_type, raised_at);
CREATE INDEX idx_gateway_alerts_gw ON gateway_alerts(gw_eui);
`;
