import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

export async function trafficRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { hours?: string; bucket?: string } }>('/traffic', async (req) => {
    const hours = Math.min(Math.max(parseInt(req.query.hours ?? '24', 10) || 24, 1), 24 * 7);
    const bucket = req.query.bucket === '1 minute' ? '1 minute' : '1 hour';
    const from = new Date(Date.now() - hours * 3_600_000).toISOString();
    // generate_series covers the full range so the chart shows zero-bars
    // for quiet hours instead of collapsing to two wide bars on sparse data.
    const { rows } = await pool.query<{ bucket: string; uplinks: string }>(
      `WITH slots AS (
         SELECT generate_series(
           time_bucket($2::interval, $1::timestamptz),
           time_bucket($2::interval, now()),
           $2::interval
         ) AS bucket
       ),
       counts AS (
         SELECT time_bucket($2::interval, timestamp) AS bucket, count(*) AS uplinks
           FROM uplinks
          WHERE timestamp >= $1
          GROUP BY bucket
       )
       SELECT slots.bucket, COALESCE(counts.uplinks, 0)::bigint AS uplinks
         FROM slots LEFT JOIN counts USING (bucket)
        ORDER BY slots.bucket ASC`,
      [from, bucket],
    );
    return {
      from,
      bucket,
      points: rows.map((r) => ({ bucket: r.bucket, uplinks: Number(r.uplinks) })),
    };
  });
}
