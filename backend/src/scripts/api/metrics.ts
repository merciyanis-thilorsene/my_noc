/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { buildSeries, SUPPORTED_METRICS } from 'scripts/api/metricsEngine';
import { parseRange, resolveBucket } from 'scripts/lib/time';

/**
 * GET /api/metrics — fleet-wide time-series (same metrics as the device endpoint).
 */
function fleetMetricsHandler(db: Db, request: FastifyRequest, reply: FastifyReply): unknown {
  const query = request.query as { metric?: string; from?: string; to?: string; bucket?: string };
  if (query.metric === undefined || !SUPPORTED_METRICS.includes(query.metric as never)) {
    return reply.status(400).send({ error: 'UNKNOWN_METRIC', supported: SUPPORTED_METRICS });
  }
  const range = parseRange(query.from, query.to, Date.now());
  const bucket = resolveBucket(query.bucket, range.fromMs, range.toMs);
  return buildSeries(db, query.metric, range, bucket, null);
}

/**
 * GET /api/joins — recent fleet-wide joins for the overview page.
 */
function recentJoinsHandler(db: Db, request: FastifyRequest): unknown {
  const query = request.query as { from?: string; to?: string; limit?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());
  const limit = Number.parseInt(query.limit ?? '50', 10);
  const items = db.prepare(`
    SELECT * FROM joins WHERE timestamp >= @from AND timestamp < @to
    ORDER BY timestamp DESC LIMIT @limit
  `).all({ from: range.from, to: range.to, limit: Number.isNaN(limit) ? 50 : limit });
  return { from: range.from, to: range.to, items };
}

/**
 * Registers fleet-wide metric routes.
 */
export default function registerFleetMetricsRoutes(instance: FastifyInstance, db: Db): void {
  instance.get('/api/metrics', (request, reply) => fleetMetricsHandler(db, request, reply));
  instance.get('/api/joins', (request) => recentJoinsHandler(db, request));
}
