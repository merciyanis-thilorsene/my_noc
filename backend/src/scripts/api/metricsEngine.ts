/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { percentile } from 'scripts/lib/metrics';
import {
  BUCKET_SECONDS,
  toIso,
  type Bucket,
  type TimeRange,
} from 'scripts/lib/time';

/**
 * A single point in a time-series response. Shape varies by metric; `t` is always present.
 */
export type SeriesPoint = Record<string, number | string | null>;

/**
 * A fully-resolved time-series result.
 */
export interface SeriesResult {
  metric: string;
  bucket: Bucket;
  from: string;
  to: string;
  series: SeriesPoint[];
}

/**
 * Metrics this engine can produce. Fleet-only metrics are accepted only when no device
 * filter is supplied.
 */
export const SUPPORTED_METRICS = [
  'uplink_count',
  'packet_loss',
  'n_b_trans',
  'rssi',
  'snr',
  'sf_distribution',
  'gateway_count',
  'airtime',
  'inter_arrival',
  'downlink_success',
  'active_devices',
] as const;

interface QueryScope {
  where: string;
  params: Record<string, unknown>;
  width: number;
}

/**
 * Builds the shared WHERE clause + params for a time range, optionally scoped to one device.
 */
function scope(table: string, range: TimeRange, bucket: Bucket, devEui: string | null): QueryScope {
  const params: Record<string, unknown> = {
    from: range.from, to: range.to, width: BUCKET_SECONDS[bucket],
  };
  let where = `${table}.timestamp >= @from AND ${table}.timestamp < @to`;
  if (devEui !== null) {
    where += ` AND ${table}.dev_eui = @devEui`;
    params.devEui = devEui;
  }
  return { where, params, width: BUCKET_SECONDS[bucket] };
}

/**
 * The SQL expression that yields a bucket-start epoch for a row's timestamp.
 */
const BUCKET_EPOCH = 'CAST(unixepoch(timestamp) / @width AS INTEGER) * @width';

/**
 * Runs a pure-SQL aggregation that already emits `bucket_epoch` and other columns, then maps
 * each row to a series point via `toPoint`.
 */
function sqlSeries(
  db: Db,
  sql: string,
  params: Record<string, unknown>,
  toPoint: (row: Record<string, number | null>) => SeriesPoint,
): SeriesPoint[] {
  const rows = db.prepare(sql).all(params) as Record<string, number | null>[];
  return rows.map((row) => ({ t: toIso(Number(row.bucket_epoch) * 1000), ...toPoint(row) }));
}

/**
 * Groups raw {bucketEpoch, value} rows in JS and computes avg/min/max/p50/p95/count per
 * bucket. Used for percentile metrics SQLite cannot aggregate natively.
 */
function distributionSeries(rows: { bucket_epoch: number; value: number }[]): SeriesPoint[] {
  const byBucket = new Map<number, number[]>();
  rows.forEach(({ bucket_epoch: epoch, value }) => {
    const list = byBucket.get(epoch);
    if (list === undefined) {
      byBucket.set(epoch, [value]);
    } else {
      list.push(value);
    }
  });
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([epoch, values]) => {
      values.sort((a, b) => a - b);
      const sum = values.reduce((acc, v) => acc + v, 0);
      return {
        t: toIso(epoch * 1000),
        avg: sum / values.length,
        min: values[0],
        max: values[values.length - 1],
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        count: values.length,
      };
    });
}

/**
 * Fetches {bucket_epoch, value} rows for a numeric uplink column, skipping NULLs.
 */
function fetchValues(
  db: Db,
  column: string,
  s: QueryScope,
): { bucket_epoch: number; value: number }[] {
  return db.prepare(`
    SELECT ${BUCKET_EPOCH} AS bucket_epoch, ${column} AS value
    FROM uplinks
    WHERE ${s.where} AND ${column} IS NOT NULL
    ORDER BY bucket_epoch ASC
  `).all(s.params) as { bucket_epoch: number; value: number }[];
}

/**
 * Computes packet loss per bucket from frame-counter gaps, ignoring session boundaries.
 *
 * f_cnt is a per-device sequence, so gaps must be computed PER DEVICE and then summed —
 * mixing devices' counters (e.g. fleet-wide) would produce meaningless gaps. Within each
 * bucket we group by dev_eui, sum each device's received + missing, and aggregate.
 */
function packetLossSeries(db: Db, s: QueryScope): SeriesPoint[] {
  const rows = db.prepare(`
    SELECT ${BUCKET_EPOCH} AS bucket_epoch, dev_eui, f_cnt
    FROM uplinks
    WHERE ${s.where}
    ORDER BY bucket_epoch ASC, dev_eui ASC, timestamp ASC, f_cnt ASC
  `).all(s.params) as { bucket_epoch: number; dev_eui: string; f_cnt: number }[];

  // bucket epoch -> dev_eui -> ordered f_cnts
  const byBucket = new Map<number, Map<string, number[]>>();
  rows.forEach(({ bucket_epoch: epoch, dev_eui: dev, f_cnt: fCnt }) => {
    let devs = byBucket.get(epoch);
    if (devs === undefined) { devs = new Map(); byBucket.set(epoch, devs); }
    const list = devs.get(dev);
    if (list === undefined) devs.set(dev, [fCnt]);
    else list.push(fCnt);
  });

  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([epoch, devs]) => {
    let received = 0;
    let missing = 0;
    let pairs = 0; // consecutive same-device frames available to measure loss
    [...devs.values()].forEach((fcnts) => {
      received += fcnts.length;
      pairs += Math.max(0, fcnts.length - 1);
      for (let i = 1; i < fcnts.length; i += 1) {
        const gap = fcnts[i] - fcnts[i - 1] - 1;
        if (gap > 0) missing += gap;
      }
    });
    const expected = received + missing;
    return {
      t: toIso(epoch * 1000),
      // Undefined when no device had two consecutive frames to compare in this bucket.
      loss_rate: pairs === 0 ? null : missing / expected,
      received,
      missing,
    };
  });
}

/**
 * Computes inter-arrival seconds (avg/p50/p95) per bucket from consecutive uplink times of
 * the same device. Pairs spanning a frame-counter reset are excluded.
 */
function interArrivalSeries(db: Db, s: QueryScope): SeriesPoint[] {
  const rows = db.prepare(`
    SELECT ${BUCKET_EPOCH} AS bucket_epoch, dev_eui, timestamp, f_cnt
    FROM uplinks
    WHERE ${s.where}
    ORDER BY dev_eui ASC, timestamp ASC, f_cnt ASC
  `).all(s.params) as { bucket_epoch: number; dev_eui: string; timestamp: string; f_cnt: number }[];

  const byBucket = new Map<number, number[]>();
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const sameSession = curr.dev_eui === prev.dev_eui && curr.f_cnt >= prev.f_cnt;
    const seconds = (Date.parse(curr.timestamp) - Date.parse(prev.timestamp)) / 1000;
    if (sameSession && seconds >= 0) {
      const list = byBucket.get(curr.bucket_epoch);
      if (list === undefined) byBucket.set(curr.bucket_epoch, [seconds]);
      else list.push(seconds);
    }
  }

  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([epoch, deltas]) => {
    deltas.sort((a, b) => a - b);
    const sum = deltas.reduce((acc, v) => acc + v, 0);
    return {
      t: toIso(epoch * 1000),
      avg: deltas.length === 0 ? null : sum / deltas.length,
      p50: percentile(deltas, 50),
      p95: percentile(deltas, 95),
      count: deltas.length,
    };
  });
}

/**
 * Computes downlink success counts per bucket by grouping lifecycle events on correlation id
 * and resolving each group to its terminal state.
 */
function downlinkSuccessSeries(
  db: Db,
  range: TimeRange,
  bucket: Bucket,
  devEui: string | null,
): SeriesPoint[] {
  const s = scope('downlinks', range, bucket, devEui);
  const rows = db.prepare(`
    SELECT ${BUCKET_EPOCH} AS bucket_epoch, correlation_ids, event_type
    FROM downlinks
    WHERE ${s.where}
    ORDER BY bucket_epoch ASC
  `).all(s.params) as { bucket_epoch: number; correlation_ids: string | null; event_type: string }[];

  // Group events by (bucket, correlation key); resolve each group's terminal state.
  const groups = new Map<string, { bucket: number; states: Set<string> }>();
  rows.forEach((row) => {
    const key = `${String(row.bucket_epoch)}|${row.correlation_ids ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { bucket: row.bucket_epoch, states: new Set([row.event_type]) });
    } else {
      group.states.add(row.event_type);
    }
  });

  const byBucket = new Map<number, { sent: number; ack: number; nack: number; failed: number }>();
  [...groups.values()].forEach(({ bucket: epoch, states }) => {
    const agg = byBucket.get(epoch) ?? {
      sent: 0, ack: 0, nack: 0, failed: 0,
    };
    if (states.has('ack')) agg.ack += 1;
    else if (states.has('failed')) agg.failed += 1;
    else if (states.has('nack')) agg.nack += 1;
    else agg.sent += 1; // queued/sent only, unresolved within the window.
    byBucket.set(epoch, agg);
  });

  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([epoch, c]) => {
    const resolved = c.ack + c.nack + c.failed;
    return {
      t: toIso(epoch * 1000),
      sent: c.sent,
      ack: c.ack,
      nack: c.nack,
      failed: c.failed,
      success_rate: resolved === 0 ? null : c.ack / resolved,
    };
  });
}

/**
 * Produces a time-series for `metric` over `range` at `bucket`, optionally scoped to one
 * device. Throws on an unknown or fleet-only-misused metric.
 */
export function buildSeries(
  db: Db,
  metric: string,
  range: TimeRange,
  bucket: Bucket,
  devEui: string | null,
): SeriesResult {
  const s = scope('uplinks', range, bucket, devEui);
  let series: SeriesPoint[];

  switch (metric) {
    case 'uplink_count':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch, COUNT(*) AS count
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({ count: row.count }));
      break;
    case 'airtime':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch, COALESCE(SUM(consumed_airtime_s), 0) AS total
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({ total: row.total }));
      break;
    case 'n_b_trans':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch, AVG(n_b_trans) AS avg, COUNT(n_b_trans) AS count
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({ avg: row.avg, count: row.count }));
      break;
    case 'gateway_count':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch, AVG(gateway_count) AS avg,
               MIN(gateway_count) AS min, MAX(gateway_count) AS max, COUNT(*) AS count
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({
        avg: row.avg, min: row.min, max: row.max, count: row.count,
      }));
      break;
    case 'sf_distribution':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch,
          SUM(CASE WHEN sf = 7 THEN 1 ELSE 0 END) AS sf7,
          SUM(CASE WHEN sf = 8 THEN 1 ELSE 0 END) AS sf8,
          SUM(CASE WHEN sf = 9 THEN 1 ELSE 0 END) AS sf9,
          SUM(CASE WHEN sf = 10 THEN 1 ELSE 0 END) AS sf10,
          SUM(CASE WHEN sf = 11 THEN 1 ELSE 0 END) AS sf11,
          SUM(CASE WHEN sf = 12 THEN 1 ELSE 0 END) AS sf12,
          COUNT(*) AS total
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({
        sf7: row.sf7,
        sf8: row.sf8,
        sf9: row.sf9,
        sf10: row.sf10,
        sf11: row.sf11,
        sf12: row.sf12,
        total: row.total,
      }));
      break;
    case 'active_devices':
      series = sqlSeries(db, `
        SELECT ${BUCKET_EPOCH} AS bucket_epoch, COUNT(DISTINCT dev_eui) AS count
        FROM uplinks WHERE ${s.where} GROUP BY bucket_epoch ORDER BY bucket_epoch ASC
      `, s.params, (row) => ({ count: row.count }));
      break;
    case 'rssi':
      series = distributionSeries(fetchValues(db, 'best_rssi', s));
      break;
    case 'snr':
      series = distributionSeries(fetchValues(db, 'best_snr', s));
      break;
    case 'packet_loss':
      series = packetLossSeries(db, s);
      break;
    case 'inter_arrival':
      series = interArrivalSeries(db, s);
      break;
    case 'downlink_success':
      series = downlinkSuccessSeries(db, range, bucket, devEui);
      break;
    default:
      throw new Error(`Unsupported metric: ${metric}`);
  }

  return {
    metric, bucket, from: range.from, to: range.to, series,
  };
}
