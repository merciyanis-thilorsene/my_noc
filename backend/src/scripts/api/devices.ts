/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import {
  aggregatesByDevice,
  currentStateByDevice,
  downlinkCountsByDevice,
  medianIntervalByDevice,
  packetLossByDevice,
} from 'scripts/api/deviceMetrics';
import { buildSeries, SUPPORTED_METRICS } from 'scripts/api/metricsEngine';
import { packetLoss } from 'scripts/lib/metrics';
import { parseRange, resolveBucket, type TimeRange } from 'scripts/lib/time';
import { normalizeEui } from 'scripts/webhooks/tts';

/**
 * A device registry row as stored.
 */
interface DeviceRecord {
  dev_eui: string;
  device_id: string;
  application_id: string;
  join_eui: string | null;
  name: string | null;
  description: string | null;
  device_class: string | null;
  lorawan_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Reads a positive integer query param, falling back to `fallback`.
 */
function intParam(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
}

/**
 * Resolves the `:dev_eui` route param to canonical form, or `null` if empty.
 */
function devEuiParam(request: FastifyRequest): string | null {
  return normalizeEui((request.params as { dev_eui?: string }).dev_eui);
}

/**
 * Computes the KPI summary for a single device over a window.
 */
function deviceWindowSummary(
  db: Db,
  devEui: string,
  range: TimeRange,
): Record<string, number | null> {
  const base = db.prepare(`
    SELECT COUNT(*) AS uplinks, AVG(n_b_trans) AS nbtrans, AVG(best_rssi) AS rssi,
           AVG(best_snr) AS snr, AVG(gateway_count) AS gw,
           COALESCE(SUM(consumed_airtime_s), 0) AS airtime
    FROM uplinks WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
  `).get({ devEui, from: range.from, to: range.to }) as {
    uplinks: number;
    nbtrans: number | null;
    rssi: number | null;
    snr: number | null;
    gw: number | null;
    airtime: number;
  };

  const fcnts = (db.prepare(`
    SELECT f_cnt FROM uplinks WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
    ORDER BY timestamp ASC, f_cnt ASC
  `).all({ devEui, from: range.from, to: range.to }) as { f_cnt: number }[]).map((r) => r.f_cnt);

  const dlRows = db.prepare(`
    SELECT correlation_ids, event_type FROM downlinks
    WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
  `).all({ devEui, from: range.from, to: range.to }) as { correlation_ids: string | null; event_type: string }[];
  const groups = new Map<string, Set<string>>();
  dlRows.forEach((row) => {
    const key = row.correlation_ids ?? '';
    const states = groups.get(key);
    if (states === undefined) groups.set(key, new Set([row.event_type]));
    else states.add(row.event_type);
  });
  let ack = 0;
  let resolved = 0;
  let failed = 0;
  [...groups.values()].forEach((states) => {
    if (states.has('ack')) {
      ack += 1;
      resolved += 1;
    } else if (states.has('failed') || states.has('nack')) {
      resolved += 1;
      failed += 1;
    }
  });

  const loss = packetLoss(fcnts);
  return {
    uplinks: base.uplinks,
    packet_loss_pct: loss.lossRate === null ? null : loss.lossRate * 100,
    n_b_trans_avg: base.nbtrans,
    avg_rssi: base.rssi,
    avg_snr: base.snr,
    avg_gateway_count: base.gw,
    total_airtime_s: base.airtime,
    downlinks_total: groups.size,
    downlinks_failed: failed,
    downlink_success_rate: resolved === 0 ? null : ack / resolved,
  };
}

/**
 * GET /api/devices — list with 24h KPIs, searchable/sortable/paginated.
 */
function listHandler(db: Db, request: FastifyRequest): unknown {
  const query = request.query as {
    search?: string; sort?: string; limit?: string; offset?: string;
  };
  const range = parseRange('24h', undefined, Date.now());
  const range7d = parseRange('7d', undefined, Date.now());

  const devices = db.prepare('SELECT * FROM devices').all() as DeviceRecord[];
  const aggregates = aggregatesByDevice(db, range);
  const losses = packetLossByDevice(db, range);
  const states = currentStateByDevice(db);
  const downlinks = downlinkCountsByDevice(db, range);
  const medians = medianIntervalByDevice(db, range7d);

  let items = devices.map((d) => {
    const agg = aggregates.get(d.dev_eui);
    const state = states.get(d.dev_eui);
    const dl = downlinks.get(d.dev_eui);
    const medianInterval = medians.get(d.dev_eui) ?? null;
    const loss = losses.get(d.dev_eui) ?? null;
    const expectedUplinks = medianInterval === null || medianInterval === 0
      ? null
      : Math.round(86400 / medianInterval);
    return {
      dev_eui: d.dev_eui,
      device_id: d.device_id,
      application_id: d.application_id,
      name: d.name,
      last_seen_at: d.last_seen_at,
      uplinks_24h: agg?.uplinks ?? 0,
      expected_uplinks_24h: expectedUplinks,
      packet_loss_pct_24h: loss === null ? null : loss * 100,
      n_b_trans_avg_24h: agg?.nBTransAvg ?? null,
      avg_rssi_24h: agg?.rssiAvg ?? null,
      avg_snr_24h: agg?.snrAvg ?? null,
      current_sf: state?.currentSf ?? null,
      battery_pct: state?.batteryPct ?? null,
      downlinks_24h: dl?.total ?? 0,
      downlinks_failed_24h: dl?.failed ?? 0,
    };
  });

  const search = query.search?.trim().toLowerCase();
  if (search !== undefined && search !== '') {
    items = items.filter((i) => (i.name?.toLowerCase().includes(search) ?? false)
      || i.dev_eui.toLowerCase().includes(search)
      || i.device_id.toLowerCase().includes(search));
  }

  const sort = query.sort ?? 'last_seen';
  items.sort((a, b) => {
    switch (sort) {
      case 'loss_rate': return (b.packet_loss_pct_24h ?? -1) - (a.packet_loss_pct_24h ?? -1);
      case 'rssi': return (a.avg_rssi_24h ?? Infinity) - (b.avg_rssi_24h ?? Infinity);
      case 'name': return (a.name ?? a.device_id).localeCompare(b.name ?? b.device_id);
      default: return b.last_seen_at.localeCompare(a.last_seen_at);
    }
  });

  const total = items.length;
  const limit = intParam(query.limit, 100);
  const offset = intParam(query.offset, 0);
  return {
    total, limit, offset, items: items.slice(offset, offset + limit),
  };
}

/**
 * GET /api/devices/:dev_eui — full record + KPIs across multiple windows.
 */
function detailHandler(db: Db, request: FastifyRequest, reply: FastifyReply): unknown {
  const devEui = devEuiParam(request);
  const device = devEui === null
    ? undefined
    : db.prepare('SELECT * FROM devices WHERE dev_eui = ?').get(devEui) as DeviceRecord | undefined;
  if (device === undefined) {
    return reply.status(404).send({ error: 'DEVICE_NOT_FOUND' });
  }
  const now = Date.now();
  const windows: Record<string, Record<string, number | null>> = {
    '24h': deviceWindowSummary(db, device.dev_eui, parseRange('24h', undefined, now)),
    '7d': deviceWindowSummary(db, device.dev_eui, parseRange('7d', undefined, now)),
    '30d': deviceWindowSummary(db, device.dev_eui, parseRange('30d', undefined, now)),
    '180d': deviceWindowSummary(db, device.dev_eui, parseRange('180d', undefined, now)),
  };
  // Most recent spreading factor — needed to evaluate the SNR margin over the SF demod floor.
  const latest = db.prepare(
    'SELECT sf FROM uplinks WHERE dev_eui = ? ORDER BY timestamp DESC LIMIT 1',
  ).get(device.dev_eui) as { sf: number | null } | undefined;
  return { device, current_sf: latest?.sf ?? null, metrics: windows };
}

/**
 * GET /api/devices/:dev_eui/uplinks — paginated history with per-gateway RF data nested.
 */
function uplinksHandler(db: Db, request: FastifyRequest): unknown {
  const devEui = devEuiParam(request);
  const query = request.query as { from?: string; to?: string; limit?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());
  const limit = intParam(query.limit, 100);

  const uplinks = db.prepare(`
    SELECT * FROM uplinks WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
    ORDER BY timestamp DESC LIMIT @limit
  `).all({
    devEui, from: range.from, to: range.to, limit,
  }) as ({ id: number } & Record<string, unknown>)[];

  const ids = uplinks.map((u) => u.id);
  const gatewaysByUplink = new Map<number, unknown[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const gwRows = db.prepare(
      `SELECT * FROM uplink_gateways WHERE uplink_id IN (${placeholders}) ORDER BY rssi DESC`,
    ).all(...ids) as ({ uplink_id: number } & Record<string, unknown>)[];
    gwRows.forEach((gw) => {
      const list = gatewaysByUplink.get(gw.uplink_id);
      if (list === undefined) gatewaysByUplink.set(gw.uplink_id, [gw]);
      else list.push(gw);
    });
  }

  return {
    from: range.from,
    to: range.to,
    items: uplinks.map((u) => ({ ...u, gateways: gatewaysByUplink.get(u.id) ?? [] })),
  };
}

/**
 * GET /api/devices/:dev_eui/downlinks — history grouped by correlation id, lifecycle nested.
 */
function downlinksHandler(db: Db, request: FastifyRequest): unknown {
  const devEui = devEuiParam(request);
  const query = request.query as { from?: string; to?: string; limit?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());

  const rows = db.prepare(`
    SELECT * FROM downlinks WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
    ORDER BY timestamp DESC
  `).all({ devEui, from: range.from, to: range.to }) as (
    { correlation_ids: string | null } & Record<string, unknown>
  )[];

  const groups = new Map<string, { first_seen: string; events: Record<string, unknown>[] }>();
  rows.forEach((row) => {
    const key = row.correlation_ids ?? `__row_${String(row.id)}`;
    const group = groups.get(key);
    const timestamp = row.timestamp as string;
    if (group === undefined) {
      groups.set(key, { first_seen: timestamp, events: [row] });
    } else {
      group.events.push(row);
      if (timestamp < group.first_seen) group.first_seen = timestamp;
    }
  });

  const limit = intParam(query.limit, 100);
  const items = [...groups.entries()]
    .map(([correlation, g]) => ({
      correlation_id: correlation,
      first_seen: g.first_seen,
      events: g.events,
    }))
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen))
    .slice(0, limit);

  return { from: range.from, to: range.to, items };
}

/**
 * GET /api/devices/:dev_eui/joins — join history for the device.
 */
function joinsHandler(db: Db, request: FastifyRequest): unknown {
  const devEui = devEuiParam(request);
  const query = request.query as { from?: string; to?: string };
  const range = parseRange(query.from ?? '7d', query.to, Date.now());
  const items = db.prepare(`
    SELECT * FROM joins WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
    ORDER BY timestamp DESC
  `).all({ devEui, from: range.from, to: range.to });
  return { from: range.from, to: range.to, items };
}

/**
 * GET /api/devices/:dev_eui/events — every uplink's raw timestamp (+ f_cnt) in the range,
 * unbucketed, for the event-timeline chart. Capped at 5000 most-recent points; `truncated`
 * flags when the cap was hit. Shaped like a metric series so the frontend reuses its plumbing.
 */
function eventsHandler(db: Db, request: FastifyRequest): unknown {
  const devEui = devEuiParam(request);
  const query = request.query as { from?: string; to?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());
  const CAP = 5000;
  const rows = db.prepare(`
    SELECT timestamp, f_cnt FROM uplinks
    WHERE dev_eui = @devEui AND timestamp >= @from AND timestamp < @to
    ORDER BY timestamp DESC LIMIT @cap
  `).all({
    devEui, from: range.from, to: range.to, cap: CAP,
  }) as { timestamp: string; f_cnt: number }[];

  return {
    metric: 'events',
    bucket: 'raw',
    from: range.from,
    to: range.to,
    truncated: rows.length === CAP,
    // Return ascending for plotting; query took the most-recent CAP.
    series: rows.reverse().map((r) => ({ t: r.timestamp, f_cnt: r.f_cnt })),
  };
}

/**
 * GET /api/devices/:dev_eui/metrics — time-series for one device.
 */
function deviceMetricsHandler(db: Db, request: FastifyRequest, reply: FastifyReply): unknown {
  const devEui = devEuiParam(request);
  const query = request.query as { metric?: string; from?: string; to?: string; bucket?: string };
  if (query.metric === undefined || !SUPPORTED_METRICS.includes(query.metric as never)) {
    return reply.status(400).send({ error: 'UNKNOWN_METRIC', supported: SUPPORTED_METRICS });
  }
  const range = parseRange(query.from, query.to, Date.now());
  const bucket = resolveBucket(query.bucket, range.fromMs, range.toMs);
  return buildSeries(db, query.metric, range, bucket, devEui);
}

/**
 * Registers all device-scoped routes.
 */
export default function registerDeviceRoutes(instance: FastifyInstance, db: Db): void {
  instance.get('/api/devices', (request) => listHandler(db, request));
  instance.get('/api/devices/:dev_eui', (request, reply) => detailHandler(db, request, reply));
  instance.get('/api/devices/:dev_eui/uplinks', (request) => uplinksHandler(db, request));
  instance.get('/api/devices/:dev_eui/downlinks', (request) => downlinksHandler(db, request));
  instance.get('/api/devices/:dev_eui/joins', (request) => joinsHandler(db, request));
  instance.get('/api/devices/:dev_eui/events', (request) => eventsHandler(db, request));
  instance.get(
    '/api/devices/:dev_eui/metrics',
    (request, reply) => deviceMetricsHandler(db, request, reply),
  );
}
