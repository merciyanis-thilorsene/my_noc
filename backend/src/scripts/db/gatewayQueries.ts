/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';

/**
 * A full gateway registry row. WMC-sourced and NOC-owned fields live side by side; the poller
 * only ever writes the WMC fields, an operator only the NOC ones.
 */
export interface GatewayRecord {
  gw_eui: string;
  name: string | null;
  customer_id: number | null;
  status: string | null;
  message_interval: number | null;
  last_status_at: string | null;
  wmc_latitude: number | null;
  wmc_longitude: number | null;
  wmc_location_type: string | null;
  created_at: string | null;
  last_polled_at: string | null;
  site_name: string | null;
  deployment_address: string | null;
  deployment_lat: number | null;
  deployment_lng: number | null;
  deployment_coord_source: string | null;
  notes: string | null;
  updated_by_noc_at: string | null;
}

/**
 * WMC-sourced fields refreshed by the poller. `gwEui` must already be canonical.
 */
export interface WmcGatewayUpsert {
  gwEui: string;
  name: string | null;
  customerId: number | null;
  status: string | null;
  messageInterval: number | null;
  lastStatusAt: string | null;
  wmcLatitude: number | null;
  wmcLongitude: number | null;
  wmcLocationType: string | null;
  createdAt: string | null;
  lastPolledAt: string;
}

/**
 * The complete set of operator-editable NOC fields. The API layer merges a partial patch onto
 * the existing row before writing, so every field is provided here.
 */
export interface NocFieldsUpdate {
  gwEui: string;
  siteName: string | null;
  deploymentAddress: string | null;
  deploymentLat: number | null;
  deploymentLng: number | null;
  deploymentCoordSource: string | null;
  notes: string | null;
  updatedByNocAt: string;
}

/**
 * A normalized gateway alert ready to insert. `gwEui` must already be canonical.
 */
export interface AlertUpsert {
  gwEui: string;
  alertType: string;
  severity: string | null;
  raisedAt: string;
  clearedAt: string | null;
  raw: string | null;
}

/**
 * A gateway list row: registry fields plus observed 24h traffic and active-alert count.
 * `last_heard_at` is all-time (not windowed) so the client can tell "heard before, silent
 * now" (§B.9's transition anomaly) from "never heard at all".
 */
export interface GatewayListItem extends GatewayRecord {
  uplinks_relayed: number;
  devices_heard: number;
  avg_rssi: number | null;
  avg_snr: number | null;
  active_alerts: number;
  last_heard_at: string | null;
}

/**
 * Observed traffic aggregate for a single gateway over a window.
 */
export interface GatewayObserved {
  uplinks_relayed: number;
  devices_heard: number;
  avg_rssi: number | null;
  avg_snr: number | null;
  last_heard_at: string | null;
}

/**
 * Upserts a gateway's WMC-sourced fields, leaving every NOC-owned field untouched.
 */
export function upsertGatewayFromWmc(db: Db, g: WmcGatewayUpsert): void {
  db.prepare(`
    INSERT INTO gateways (
      gw_eui, name, customer_id, status, message_interval, last_status_at,
      wmc_latitude, wmc_longitude, wmc_location_type, created_at, last_polled_at
    ) VALUES (
      @gwEui, @name, @customerId, @status, @messageInterval, @lastStatusAt,
      @wmcLatitude, @wmcLongitude, @wmcLocationType, @createdAt, @lastPolledAt
    )
    ON CONFLICT(gw_eui) DO UPDATE SET
      name              = excluded.name,
      customer_id       = excluded.customer_id,
      status            = excluded.status,
      message_interval  = excluded.message_interval,
      last_status_at    = excluded.last_status_at,
      wmc_latitude      = excluded.wmc_latitude,
      wmc_longitude     = excluded.wmc_longitude,
      wmc_location_type = excluded.wmc_location_type,
      created_at        = excluded.created_at,
      last_polled_at    = excluded.last_polled_at
  `).run(g);
}

/**
 * Writes the NOC-owned fields for a gateway, creating the row if WMC has never surfaced it
 * (a gateway may be known only from observed `uplink_gateways`).
 */
export function updateGatewayNocFields(db: Db, fields: NocFieldsUpdate): void {
  db.prepare(`
    INSERT INTO gateways (
      gw_eui, site_name, deployment_address, deployment_lat, deployment_lng,
      deployment_coord_source, notes, updated_by_noc_at
    ) VALUES (
      @gwEui, @siteName, @deploymentAddress, @deploymentLat, @deploymentLng,
      @deploymentCoordSource, @notes, @updatedByNocAt
    )
    ON CONFLICT(gw_eui) DO UPDATE SET
      site_name               = excluded.site_name,
      deployment_address      = excluded.deployment_address,
      deployment_lat          = excluded.deployment_lat,
      deployment_lng          = excluded.deployment_lng,
      deployment_coord_source = excluded.deployment_coord_source,
      notes                   = excluded.notes,
      updated_by_noc_at       = excluded.updated_by_noc_at
  `).run(fields);
}

/**
 * Returns a single gateway registry row, or `undefined` if unknown.
 */
export function getGateway(db: Db, gwEui: string): GatewayRecord | undefined {
  return db.prepare('SELECT * FROM gateways WHERE gw_eui = ?').get(gwEui) as GatewayRecord | undefined;
}

/**
 * Lists every gateway known from WMC or from observed traffic in the window, joined with its
 * 24h observed traffic and active (uncleared, unacknowledged) alert count.
 */
export function listGatewaysWithTraffic(db: Db, fromIso: string): GatewayListItem[] {
  return db.prepare(`
    SELECT
      k.gw_eui AS gw_eui,
      g.name, g.customer_id, g.status, g.message_interval, g.last_status_at,
      g.wmc_latitude, g.wmc_longitude, g.wmc_location_type, g.created_at, g.last_polled_at,
      g.site_name, g.deployment_address, g.deployment_lat, g.deployment_lng,
      g.deployment_coord_source, g.notes, g.updated_by_noc_at,
      COALESCE(obs.uplinks_relayed, 0) AS uplinks_relayed,
      COALESCE(obs.devices_heard, 0) AS devices_heard,
      obs.avg_rssi, obs.avg_snr,
      COALESCE(al.active_alerts, 0) AS active_alerts,
      heard.last_heard_at
    FROM (
      SELECT gw_eui FROM gateways
      UNION
      SELECT DISTINCT gateway_eui FROM uplink_gateways
      WHERE gateway_eui IS NOT NULL AND timestamp >= @from
    ) k
    LEFT JOIN gateways g ON g.gw_eui = k.gw_eui
    LEFT JOIN (
      SELECT ug.gateway_eui AS gw_eui,
             COUNT(*) AS uplinks_relayed,
             COUNT(DISTINCT u.dev_eui) AS devices_heard,
             AVG(ug.rssi) AS avg_rssi,
             AVG(ug.snr) AS avg_snr
      FROM uplink_gateways ug
      JOIN uplinks u ON u.id = ug.uplink_id
      WHERE ug.gateway_eui IS NOT NULL AND ug.timestamp >= @from
      GROUP BY ug.gateway_eui
    ) obs ON obs.gw_eui = k.gw_eui
    LEFT JOIN (
      SELECT gw_eui, COUNT(*) AS active_alerts
      FROM gateway_alerts WHERE cleared_at IS NULL AND acknowledged = 0
      GROUP BY gw_eui
    ) al ON al.gw_eui = k.gw_eui
    LEFT JOIN (
      SELECT gateway_eui AS gw_eui, MAX(timestamp) AS last_heard_at
      FROM uplink_gateways WHERE gateway_eui IS NOT NULL
      GROUP BY gateway_eui
    ) heard ON heard.gw_eui = k.gw_eui
    ORDER BY uplinks_relayed DESC, k.gw_eui ASC
  `).all({ from: fromIso }) as GatewayListItem[];
}

/**
 * Observed traffic aggregate for one gateway over a window.
 */
export function getGatewayObserved(db: Db, gwEui: string, fromIso: string): GatewayObserved {
  const row = db.prepare(`
    SELECT COUNT(*) AS uplinks_relayed,
           COUNT(DISTINCT u.dev_eui) AS devices_heard,
           AVG(ug.rssi) AS avg_rssi,
           AVG(ug.snr) AS avg_snr,
           MAX(ug.timestamp) AS last_heard_at
    FROM uplink_gateways ug
    JOIN uplinks u ON u.id = ug.uplink_id
    WHERE ug.gateway_eui = @gwEui AND ug.timestamp >= @from
  `).get({ gwEui, from: fromIso }) as GatewayObserved;
  return row;
}

/**
 * Devices a gateway has heard in the window, most-active first.
 */
export function getGatewayDevices(
  db: Db,
  gwEui: string,
  fromIso: string,
): Record<string, unknown>[] {
  return db.prepare(`
    SELECT u.dev_eui AS dev_eui,
           MAX(u.device_id) AS device_id,
           MAX(d.name) AS name,
           COUNT(*) AS uplinks,
           AVG(ug.rssi) AS avg_rssi,
           AVG(ug.snr) AS avg_snr,
           MAX(ug.timestamp) AS last_heard_at
    FROM uplink_gateways ug
    JOIN uplinks u ON u.id = ug.uplink_id
    LEFT JOIN devices d ON d.dev_eui = u.dev_eui
    WHERE ug.gateway_eui = @gwEui AND ug.timestamp >= @from
    GROUP BY u.dev_eui
    ORDER BY uplinks DESC
  `).all({ gwEui, from: fromIso }) as Record<string, unknown>[];
}

/**
 * Gateways that have heard a given device in the window, most-active first (the inverse of
 * {@link getGatewayDevices}). Joins to the gateway registry for a display name; TTS uplinks
 * only, since Orange carries no per-gateway EUIs.
 */
export function getDeviceGateways(
  db: Db,
  devEui: string,
  fromIso: string,
): Record<string, unknown>[] {
  return db.prepare(`
    SELECT ug.gateway_eui AS gw_eui,
           MAX(g.name) AS name,
           MAX(g.site_name) AS site_name,
           g.status AS status,
           COUNT(*) AS uplinks,
           AVG(ug.rssi) AS avg_rssi,
           AVG(ug.snr) AS avg_snr,
           MAX(ug.timestamp) AS last_heard_at
    FROM uplink_gateways ug
    JOIN uplinks u ON u.id = ug.uplink_id
    LEFT JOIN gateways g ON g.gw_eui = ug.gateway_eui
    WHERE u.dev_eui = @devEui AND ug.gateway_eui IS NOT NULL AND ug.timestamp >= @from
    GROUP BY ug.gateway_eui
    ORDER BY uplinks DESC
  `).all({ devEui, from: fromIso }) as Record<string, unknown>[];
}

/**
 * Devices heard by exactly one distinct gateway in the window — a redundancy risk: they have
 * no path diversity, so that single gateway going down drops them silently. Considers only
 * reception with a known gateway EUI (TTS), so Orange-only devices — which carry no per-gateway
 * EUI — never appear here. Busiest first (highest-impact single points of failure).
 */
export function getSingleGatewayDevices(db: Db, fromIso: string): Record<string, unknown>[] {
  return db.prepare(`
    SELECT u.dev_eui AS dev_eui,
           MAX(u.device_id) AS device_id,
           MAX(d.name) AS name,
           COUNT(*) AS uplinks,
           MAX(ug.timestamp) AS last_heard_at,
           MIN(ug.gateway_eui) AS gw_eui,
           MAX(gw.name) AS gw_name,
           MAX(gw.site_name) AS gw_site_name
    FROM uplink_gateways ug
    JOIN uplinks u ON u.id = ug.uplink_id
    LEFT JOIN devices d ON d.dev_eui = u.dev_eui
    LEFT JOIN gateways gw ON gw.gw_eui = ug.gateway_eui
    WHERE ug.gateway_eui IS NOT NULL AND ug.timestamp >= @from
    GROUP BY u.dev_eui
    HAVING COUNT(DISTINCT ug.gateway_eui) = 1
    ORDER BY uplinks DESC
  `).all({ from: fromIso }) as Record<string, unknown>[];
}

/**
 * Per-bucket observed traffic and RF for one gateway, for the detail-page charts.
 */
export function getGatewaySeries(
  db: Db,
  gwEui: string,
  fromIso: string,
  bucketSeconds: number,
): Record<string, number | string | null>[] {
  const rows = db.prepare(`
    SELECT CAST(unixepoch(timestamp) / @width AS INTEGER) * @width AS bucket_epoch,
           COUNT(*) AS uplinks,
           AVG(rssi) AS avg_rssi,
           AVG(snr) AS avg_snr
    FROM uplink_gateways
    WHERE gateway_eui = @gwEui AND timestamp >= @from
    GROUP BY bucket_epoch
    ORDER BY bucket_epoch ASC
  `).all({ gwEui, from: fromIso, width: bucketSeconds }) as {
    bucket_epoch: number; uplinks: number; avg_rssi: number | null; avg_snr: number | null;
  }[];
  return rows.map((r) => ({
    t: new Date(r.bucket_epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    uplinks: r.uplinks,
    avg_rssi: r.avg_rssi,
    avg_snr: r.avg_snr,
  }));
}

/**
 * Inserts a gateway alert, or — on a re-delivery matching `(gw_eui, alert_type, raised_at)` —
 * refreshes its mutable fields. `acknowledged` is operator-controlled and never reset by a
 * re-delivery; a re-delivery without `cleared_at` does not wipe a previously set one.
 */
export function insertOrUpdateAlert(db: Db, alert: AlertUpsert): void {
  db.prepare(`
    INSERT INTO gateway_alerts (gw_eui, alert_type, severity, raised_at, cleared_at, raw, acknowledged)
    VALUES (@gwEui, @alertType, @severity, @raisedAt, @clearedAt, @raw, 0)
    ON CONFLICT(gw_eui, alert_type, raised_at) DO UPDATE SET
      severity   = excluded.severity,
      cleared_at = COALESCE(excluded.cleared_at, gateway_alerts.cleared_at),
      raw        = excluded.raw
  `).run(alert);
}

/**
 * Alert history for a gateway, newest first.
 */
export function getGatewayAlerts(db: Db, gwEui: string): Record<string, unknown>[] {
  return db.prepare(
    'SELECT * FROM gateway_alerts WHERE gw_eui = ? ORDER BY raised_at DESC LIMIT 200',
  ).all(gwEui) as Record<string, unknown>[];
}

/**
 * Fleet-wide recent alerts (newest first), each carrying its gateway's display name so the
 * overview feed can render without a second lookup.
 */
export function listRecentAlerts(db: Db, limit: number): Record<string, unknown>[] {
  return db.prepare(`
    SELECT a.id, a.gw_eui, a.alert_type, a.severity, a.raised_at, a.cleared_at, a.acknowledged,
           g.name AS gateway_name, g.site_name
    FROM gateway_alerts a
    LEFT JOIN gateways g ON g.gw_eui = a.gw_eui
    ORDER BY a.raised_at DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[];
}
