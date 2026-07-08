/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';

/**
 * Device registry fields learned from an event payload.
 */
export interface DeviceUpsert {
  devEui: string;
  deviceId: string;
  applicationId: string;
  joinEui: string | null;
  name: string | null;
  description: string | null;
  deviceClass: string | null;
  lorawanVersion: string | null;
  seenAt: string;
}

/**
 * A normalized uplink ready to insert. Gateway rows are inserted alongside it.
 */
export interface UplinkRow {
  timestamp: string;
  devEui: string;
  deviceId: string;
  applicationId: string;
  fCnt: number;
  fPort: number | null;
  frmPayload: string | null;
  decodedPayload: string | null;
  dataRateIndex: number | null;
  sf: number | null;
  bandwidth: number | null;
  codingRate: string | null;
  frequency: number | null;
  consumedAirtimeS: number | null;
  confirmed: number | null;
  adr: number | null;
  classB: number | null;
  nBTrans: number | null;
  bestRssi: number | null;
  bestSnr: number | null;
  gatewayCount: number;
  receivedAt: string;
  correlationIds: string | null;
}

/**
 * Per-gateway RF metrics attached to an uplink.
 */
export interface GatewayRow {
  gatewayEui: string | null;
  gatewayId: string | null;
  rssi: number | null;
  snr: number | null;
  channelIndex: number | null;
  channelRssi: number | null;
  timestamp: string;
  locationLatitude: number | null;
  locationLongitude: number | null;
}

/**
 * A normalized join_accept ready to insert.
 */
export interface JoinRow {
  timestamp: string;
  devEui: string;
  deviceId: string;
  applicationId: string;
  joinEui: string | null;
  devAddr: string | null;
  receivedAt: string;
}

/**
 * A normalized downlink lifecycle event ready to insert.
 */
export interface DownlinkRow {
  timestamp: string;
  devEui: string;
  deviceId: string;
  applicationId: string;
  eventType: string;
  fPort: number | null;
  confirmed: number | null;
  frmPayload: string | null;
  sessionKeyId: string | null;
  correlationIds: string | null;
  receivedAt: string;
}

/**
 * Upserts a device, advancing `last_seen_at` and backfilling metadata when newly available.
 * `first_seen_at` is kept at the earliest observed event time.
 */
export function upsertDevice(db: Db, d: DeviceUpsert): void {
  db.prepare(`
    INSERT INTO devices (
      dev_eui, device_id, application_id, join_eui, name, description,
      device_class, lorawan_version, first_seen_at, last_seen_at
    ) VALUES (
      @devEui, @deviceId, @applicationId, @joinEui, @name, @description,
      @deviceClass, @lorawanVersion, @seenAt, @seenAt
    )
    ON CONFLICT(dev_eui) DO UPDATE SET
      device_id       = excluded.device_id,
      application_id  = excluded.application_id,
      join_eui        = COALESCE(excluded.join_eui, devices.join_eui),
      name            = COALESCE(excluded.name, devices.name),
      description     = COALESCE(excluded.description, devices.description),
      device_class    = COALESCE(excluded.device_class, devices.device_class),
      lorawan_version = COALESCE(excluded.lorawan_version, devices.lorawan_version),
      first_seen_at   = MIN(devices.first_seen_at, excluded.first_seen_at),
      last_seen_at    = MAX(devices.last_seen_at, excluded.last_seen_at)
  `).run(d);
}

/**
 * Inserts an uplink and its per-gateway rows in a single transaction.
 */
export function insertUplink(db: Db, uplink: UplinkRow, gateways: GatewayRow[]): void {
  const insertUplinkStmt = db.prepare(`
    INSERT OR IGNORE INTO uplinks (
      timestamp, dev_eui, device_id, application_id, f_cnt, f_port, frm_payload,
      decoded_payload, data_rate_index, sf, bandwidth, coding_rate, frequency,
      consumed_airtime_s, confirmed, adr, class_b, n_b_trans, best_rssi, best_snr,
      gateway_count, received_at, correlation_ids
    ) VALUES (
      @timestamp, @devEui, @deviceId, @applicationId, @fCnt, @fPort, @frmPayload,
      @decodedPayload, @dataRateIndex, @sf, @bandwidth, @codingRate, @frequency,
      @consumedAirtimeS, @confirmed, @adr, @classB, @nBTrans, @bestRssi, @bestSnr,
      @gatewayCount, @receivedAt, @correlationIds
    )
  `);
  const insertGatewayStmt = db.prepare(`
    INSERT INTO uplink_gateways (
      uplink_id, gateway_eui, gateway_id, rssi, snr, channel_index, channel_rssi,
      timestamp, location_latitude, location_longitude
    ) VALUES (
      @uplinkId, @gatewayEui, @gatewayId, @rssi, @snr, @channelIndex, @channelRssi,
      @timestamp, @locationLatitude, @locationLongitude
    )
  `);
  const tx = db.transaction(() => {
    const { changes, lastInsertRowid } = insertUplinkStmt.run(uplink);
    // A retried webhook delivery is a duplicate (same dev_eui, f_cnt, timestamp) and is ignored;
    // its gateway rows would orphan onto the already-stored uplink, so skip them too.
    if (changes === 0) {
      return;
    }
    gateways.forEach((gw) => {
      insertGatewayStmt.run({ ...gw, uplinkId: lastInsertRowid });
    });
  });
  tx();
}

/**
 * Inserts a join_accept event.
 */
export function insertJoin(db: Db, j: JoinRow): void {
  db.prepare(`
    INSERT INTO joins (
      timestamp, dev_eui, device_id, application_id, join_eui, dev_addr, received_at
    ) VALUES (
      @timestamp, @devEui, @deviceId, @applicationId, @joinEui, @devAddr, @receivedAt
    )
  `).run(j);
}

/**
 * Inserts a single downlink lifecycle event.
 */
export function insertDownlink(db: Db, d: DownlinkRow): void {
  db.prepare(`
    INSERT INTO downlinks (
      timestamp, dev_eui, device_id, application_id, event_type, f_port, confirmed,
      frm_payload, session_key_id, correlation_ids, received_at
    ) VALUES (
      @timestamp, @devEui, @deviceId, @applicationId, @eventType, @fPort, @confirmed,
      @frmPayload, @sessionKeyId, @correlationIds, @receivedAt
    )
  `).run(d);
}

/**
 * Deletes events older than `cutoffIso` from all event tables. uplink_gateways rows are
 * removed via the ON DELETE CASCADE foreign key. Returns the number of uplinks deleted.
 */
export function deleteOlderThan(
  db: Db,
  cutoffIso: string,
): { uplinks: number; joins: number; downlinks: number } {
  const tx = db.transaction(() => {
    const uplinks = db.prepare('DELETE FROM uplinks WHERE timestamp < ?').run(cutoffIso).changes;
    const joins = db.prepare('DELETE FROM joins WHERE timestamp < ?').run(cutoffIso).changes;
    const downlinks = db.prepare('DELETE FROM downlinks WHERE timestamp < ?').run(cutoffIso).changes;
    return { uplinks, joins, downlinks };
  });
  return tx();
}
