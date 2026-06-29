/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { median, packetLoss } from 'scripts/lib/metrics';
import { type TimeRange } from 'scripts/lib/time';

/**
 * Candidate field names a payload decoder might use for battery level (percent).
 */
const BATTERY_KEYS = ['battery_pct', 'batteryLevel', 'battery_level', 'battery', 'bat', 'soc'];

/**
 * Best-effort extraction of a battery percentage from a decoded payload JSON string.
 * Returns `null` when no recognizable battery field is present.
 */
export function extractBattery(decodedPayload: string | null): number | null {
  if (decodedPayload === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodedPayload) as Record<string, unknown>;
    const value = BATTERY_KEYS.map((key) => parsed[key]).find((v) => typeof v === 'number');
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Simple aggregates per device over a window: uplink count and average NbTrans/RSSI/SNR.
 */
export interface DeviceAggregate {
  uplinks: number;
  nBTransAvg: number | null;
  rssiAvg: number | null;
  snrAvg: number | null;
}

/**
 * Computes {@link DeviceAggregate} for every device with uplinks in the window.
 */
export function aggregatesByDevice(db: Db, range: TimeRange): Map<string, DeviceAggregate> {
  const rows = db.prepare(`
    SELECT dev_eui,
           COUNT(*) AS uplinks,
           AVG(n_b_trans) AS nbtrans_avg,
           AVG(best_rssi) AS rssi_avg,
           AVG(best_snr) AS snr_avg
    FROM uplinks
    WHERE timestamp >= @from AND timestamp < @to
    GROUP BY dev_eui
  `).all(range) as {
    dev_eui: string;
    uplinks: number;
    nbtrans_avg: number | null;
    rssi_avg: number | null;
    snr_avg: number | null;
  }[];
  const map = new Map<string, DeviceAggregate>();
  rows.forEach((r) => {
    map.set(r.dev_eui, {
      uplinks: r.uplinks, nBTransAvg: r.nbtrans_avg, rssiAvg: r.rssi_avg, snrAvg: r.snr_avg,
    });
  });
  return map;
}

/**
 * Computes packet-loss rate per device over a window from frame-counter gaps.
 */
export function packetLossByDevice(db: Db, range: TimeRange): Map<string, number | null> {
  const rows = db.prepare(`
    SELECT dev_eui, f_cnt
    FROM uplinks
    WHERE timestamp >= @from AND timestamp < @to
    ORDER BY dev_eui ASC, timestamp ASC, f_cnt ASC
  `).all(range) as { dev_eui: string; f_cnt: number }[];

  const byDevice = new Map<string, number[]>();
  rows.forEach(({ dev_eui: devEui, f_cnt: fCnt }) => {
    const list = byDevice.get(devEui);
    if (list === undefined) byDevice.set(devEui, [fCnt]);
    else list.push(fCnt);
  });
  const result = new Map<string, number | null>();
  byDevice.forEach((fcnts, devEui) => {
    result.set(devEui, packetLoss(fcnts).lossRate);
  });
  return result;
}

/**
 * Latest known per-device state derived from the most recent uplink.
 */
export interface DeviceCurrentState {
  currentSf: number | null;
  dataRateIndex: number | null;
  batteryPct: number | null;
  lastUplinkAt: string | null;
}

/**
 * Computes current state for every device from its most recent uplink.
 */
export function currentStateByDevice(db: Db): Map<string, DeviceCurrentState> {
  const rows = db.prepare(`
    SELECT u.dev_eui, u.sf, u.data_rate_index, u.decoded_payload, u.timestamp
    FROM uplinks u
    JOIN (SELECT dev_eui, MAX(timestamp) AS max_ts FROM uplinks GROUP BY dev_eui) latest
      ON latest.dev_eui = u.dev_eui AND latest.max_ts = u.timestamp
    GROUP BY u.dev_eui
  `).all() as {
    dev_eui: string;
    sf: number | null;
    data_rate_index: number | null;
    decoded_payload: string | null;
    timestamp: string;
  }[];
  const map = new Map<string, DeviceCurrentState>();
  rows.forEach((r) => {
    map.set(r.dev_eui, {
      currentSf: r.sf,
      dataRateIndex: r.data_rate_index,
      batteryPct: extractBattery(r.decoded_payload),
      lastUplinkAt: r.timestamp,
    });
  });
  return map;
}

/**
 * Downlink counts per device over a window: total logical downlinks and failed ones,
 * grouped by correlation id and resolved to a terminal state.
 */
export interface DownlinkCounts {
  total: number;
  failed: number;
}

/**
 * Computes {@link DownlinkCounts} for every device with downlinks in the window.
 */
export function downlinkCountsByDevice(db: Db, range: TimeRange): Map<string, DownlinkCounts> {
  const rows = db.prepare(`
    SELECT dev_eui, correlation_ids, event_type
    FROM downlinks
    WHERE timestamp >= @from AND timestamp < @to
  `).all(range) as { dev_eui: string; correlation_ids: string | null; event_type: string }[];

  const groups = new Map<string, { devEui: string; states: Set<string> }>();
  rows.forEach((row) => {
    const key = `${row.dev_eui}|${row.correlation_ids ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { devEui: row.dev_eui, states: new Set([row.event_type]) });
    } else {
      group.states.add(row.event_type);
    }
  });

  const result = new Map<string, DownlinkCounts>();
  [...groups.values()].forEach(({ devEui, states }) => {
    const counts = result.get(devEui) ?? { total: 0, failed: 0 };
    counts.total += 1;
    if (!states.has('ack') && (states.has('failed') || states.has('nack'))) {
      counts.failed += 1;
    }
    result.set(devEui, counts);
  });
  return result;
}

/**
 * Median inter-arrival seconds per device over a window (capped lookback recommended at 7d),
 * excluding pairs that span a frame-counter reset. Used to infer expected cadence.
 */
export function medianIntervalByDevice(db: Db, range: TimeRange): Map<string, number | null> {
  const rows = db.prepare(`
    SELECT dev_eui, timestamp, f_cnt
    FROM uplinks
    WHERE timestamp >= @from AND timestamp < @to
    ORDER BY dev_eui ASC, timestamp ASC, f_cnt ASC
  `).all(range) as { dev_eui: string; timestamp: string; f_cnt: number }[];

  const byDevice = new Map<string, number[]>();
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const sameSession = curr.dev_eui === prev.dev_eui && curr.f_cnt >= prev.f_cnt;
    const seconds = (Date.parse(curr.timestamp) - Date.parse(prev.timestamp)) / 1000;
    if (sameSession && seconds >= 0) {
      const list = byDevice.get(curr.dev_eui);
      if (list === undefined) byDevice.set(curr.dev_eui, [seconds]);
      else list.push(seconds);
    }
  }
  const result = new Map<string, number | null>();
  byDevice.forEach((deltas, devEui) => {
    result.set(devEui, median(deltas));
  });
  return result;
}
