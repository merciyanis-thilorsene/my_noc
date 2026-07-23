/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { type TimeRange } from 'scripts/lib/time';

const EXPORT_CAP = 50000;

const CSV_COLUMNS = [
  'timestamp', 'dev_eui', 'device_id', 'application_id', 'f_cnt', 'f_port', 'sf', 'bandwidth',
  'coding_rate', 'data_rate_index', 'frequency', 'consumed_airtime_s', 'n_b_trans', 'adr',
  'confirmed', 'best_rssi', 'best_snr', 'gateway_count', 'received_at', 'frm_payload', 'decoded_payload',
];

const DOWNLINK_CSV_COLUMNS = [
  'timestamp', 'dev_eui', 'device_id', 'application_id', 'event_type', 'f_port', 'confirmed',
  'frm_payload', 'session_key_id', 'correlation_ids', 'received_at',
];

/** Escapes a value for a CSV cell (RFC 4180 quoting). */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else s = JSON.stringify(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parses a stored JSON string back to a value; returns the raw string on failure. */
function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * A ready-to-send export payload.
 */
export interface ExportResult {
  filename: string;
  isCsv: boolean;
  body: string | object;
}

/**
 * Builds a raw-uplink export for one or more devices over a range, capped at 50000 rows.
 * CSV is one flat row per uplink; JSON nests per-gateway RF and parses decoded payloads.
 */
export function exportUplinks(
  db: Db,
  devEuis: string[],
  range: TimeRange,
  format: string | undefined,
): ExportResult {
  const isCsv = format === 'csv';
  const stamp = range.to.replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
  const filename = devEuis.length === 1
    ? `${devEuis[0]}_uplinks_${stamp}`
    : `uplinks_${String(devEuis.length)}devices_${stamp}`;

  if (devEuis.length === 0) {
    return {
      filename,
      isCsv,
      body: isCsv ? CSV_COLUMNS.join(',') : {
        from: range.from, to: range.to, count: 0, uplinks: [],
      },
    };
  }

  const placeholders = devEuis.map(() => '?').join(',');
  const uplinks = db.prepare(`
    SELECT * FROM uplinks
    WHERE dev_eui IN (${placeholders}) AND timestamp >= ? AND timestamp < ?
    ORDER BY dev_eui ASC, timestamp ASC LIMIT ?
  `).all(...devEuis, range.from, range.to, EXPORT_CAP) as ({ id: number } & Record<string, unknown>)[];

  if (isCsv) {
    const rows = uplinks.map((u) => CSV_COLUMNS.map((c) => csvCell(u[c])).join(','));
    return { filename, isCsv, body: [CSV_COLUMNS.join(','), ...rows].join('\n') };
  }

  const ids = uplinks.map((u) => u.id);
  const gatewaysByUplink = new Map<number, unknown[]>();
  if (ids.length > 0) {
    const gwPlaceholders = ids.map(() => '?').join(',');
    const gwRows = db.prepare(
      `SELECT * FROM uplink_gateways WHERE uplink_id IN (${gwPlaceholders}) ORDER BY rssi DESC`,
    ).all(...ids) as ({ uplink_id: number } & Record<string, unknown>)[];
    gwRows.forEach((gw) => {
      const list = gatewaysByUplink.get(gw.uplink_id);
      if (list === undefined) gatewaysByUplink.set(gw.uplink_id, [gw]);
      else list.push(gw);
    });
  }

  const items = uplinks.map((u) => ({
    ...u,
    decoded_payload: parseJson(u.decoded_payload as string | null),
    correlation_ids: parseJson(u.correlation_ids as string | null),
    gateways: gatewaysByUplink.get(u.id) ?? [],
  }));
  return {
    filename,
    isCsv,
    body: {
      dev_euis: devEuis,
      from: range.from,
      to: range.to,
      count: items.length,
      truncated: items.length === EXPORT_CAP,
      uplinks: items,
    },
  };
}

/**
 * Builds a raw-downlink export for one or more devices over a range, capped at 50000 rows.
 * Downlinks are flat lifecycle events (queued/sent/ack/nack/failed) with no child table.
 */
export function exportDownlinks(
  db: Db,
  devEuis: string[],
  range: TimeRange,
  format: string | undefined,
): ExportResult {
  const isCsv = format === 'csv';
  const stamp = range.to.replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
  const filename = devEuis.length === 1
    ? `${devEuis[0]}_downlinks_${stamp}`
    : `downlinks_${String(devEuis.length)}devices_${stamp}`;

  if (devEuis.length === 0) {
    return {
      filename,
      isCsv,
      body: isCsv ? DOWNLINK_CSV_COLUMNS.join(',') : {
        from: range.from, to: range.to, count: 0, downlinks: [],
      },
    };
  }

  const placeholders = devEuis.map(() => '?').join(',');
  const downlinks = db.prepare(`
    SELECT * FROM downlinks
    WHERE dev_eui IN (${placeholders}) AND timestamp >= ? AND timestamp < ?
    ORDER BY dev_eui ASC, timestamp ASC LIMIT ?
  `).all(...devEuis, range.from, range.to, EXPORT_CAP) as ({ id: number } & Record<string, unknown>)[];

  if (isCsv) {
    const rows = downlinks.map((d) => DOWNLINK_CSV_COLUMNS.map((c) => csvCell(d[c])).join(','));
    return { filename, isCsv, body: [DOWNLINK_CSV_COLUMNS.join(','), ...rows].join('\n') };
  }

  const items = downlinks.map((d) => ({
    ...d,
    correlation_ids: parseJson(d.correlation_ids as string | null),
  }));
  return {
    filename,
    isCsv,
    body: {
      dev_euis: devEuis,
      from: range.from,
      to: range.to,
      count: items.length,
      truncated: items.length === EXPORT_CAP,
      downlinks: items,
    },
  };
}

/**
 * Sets download headers for an {@link ExportResult} on a Fastify reply.
 */
export function exportHeaders(isCsv: boolean, filename: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Disposition': `attachment; filename="${filename}.${isCsv ? 'csv' : 'json'}"`,
  };
  if (isCsv) headers['Content-Type'] = 'text/csv; charset=utf-8';
  return headers;
}
