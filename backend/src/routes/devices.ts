import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { getDevice, listDeviceEuis } from '../cache/registry.js';
import { computeLoss, computeLossPerBucket } from '../ingest/packet_loss.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Composite RF quality in [0, 100] from RSSI (dBm) and SNR (dB).
// RSSI maps linearly over [-130, -70]; SNR maps linearly over [-20, +10].
// Each dimension capped to [0, 100] then averaged.
function rfQuality(rssi: number | null, snr: number | null): number | null {
  if (rssi == null && snr == null) return null;
  const clamp = (x: number): number => Math.max(0, Math.min(100, x));
  const rScore = rssi != null ? clamp(((rssi - (-130)) / 60) * 100) : null;
  const sScore = snr  != null ? clamp(((snr  - (-20)) / 30) * 100) : null;
  if (rScore != null && sScore != null) return round1((rScore + sScore) / 2);
  return round1((rScore ?? sScore)!);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/devices', async () => {
    const euis = await listDeviceEuis();
    if (euis.length === 0) return { items: [] };

    const [lastRows, rollingRows] = await Promise.all([
      pool.query<{
        device_eui: string;
        timestamp: string;
        best_rssi: number | null;
        best_snr: number | null;
        sf: number | null;
        f_cnt_up: string | null;
        gateway_count: number | null;
      }>(
        `SELECT DISTINCT ON (device_eui)
                device_eui, timestamp, best_rssi, best_snr, sf, f_cnt_up, gateway_count
           FROM uplinks
          WHERE device_eui = ANY($1)
          ORDER BY device_eui, timestamp DESC`,
        [euis],
      ),
      pool.query<{
        device_eui: string;
        rssi_avg: number | null;
        snr_avg: number | null;
      }>(
        `SELECT device_eui, avg(best_rssi) AS rssi_avg, avg(best_snr) AS snr_avg
           FROM uplinks
          WHERE device_eui = ANY($1) AND timestamp > now() - INTERVAL '1 hour'
          GROUP BY device_eui`,
        [euis],
      ),
    ]);

    const lastByEui = new Map(lastRows.rows.map((r) => [r.device_eui, r]));
    const rollingByEui = new Map(rollingRows.rows.map((r) => [r.device_eui, r]));

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date().toISOString();

    const items = await Promise.all(
      euis.map(async (eui) => {
        const reg = (await getDevice(eui)) ?? {};
        const last = lastByEui.get(eui);
        const rolling = rollingByEui.get(eui);
        const loss = await computeLoss(eui, from, to);
        return {
          ...reg,
          dev_eui: eui,
          last_seen:      last?.timestamp ?? null,
          last_rssi:      last?.best_rssi ?? null,
          last_snr:       last?.best_snr ?? null,
          last_sf:        last?.sf ?? null,
          last_f_cnt_up:  last?.f_cnt_up != null ? Number(last.f_cnt_up) : null,
          gateway_count:  last?.gateway_count ?? null,
          rf_quality:     rfQuality(rolling?.rssi_avg ?? last?.best_rssi ?? null,
                                     rolling?.snr_avg  ?? last?.best_snr  ?? null),
          loss_pct_1h:    loss.expected > 0 ? round1(loss.loss_pct) : null,
        };
      }),
    );
    return { items };
  });

  app.get<{ Params: { dev_eui: string }; Querystring: { hours?: string } }>(
    '/devices/:dev_eui/packet-loss', async (req) => {
      const dev_eui = req.params.dev_eui.toUpperCase();
      const hours = Math.min(Math.max(parseInt(req.query.hours ?? '24', 10) || 24, 1), 24 * 7);
      const bucket: '1 hour' | '15 minutes' = hours <= 6 ? '15 minutes' : '1 hour';
      const from = new Date(Date.now() - hours * 3_600_000).toISOString();
      const to = new Date().toISOString();
      const [totals, points] = await Promise.all([
        computeLoss(dev_eui, from, to),
        computeLossPerBucket(dev_eui, from, to, bucket),
      ]);
      return {
        dev_eui, from, to, bucket,
        totals: {
          received: totals.received,
          expected: totals.expected,
          loss_pct: round1(totals.loss_pct),
        },
        points: points.map((p) => ({ ...p, loss_pct: round1(p.loss_pct) })),
      };
    });

  app.get<{ Params: { dev_eui: string } }>('/devices/:dev_eui', async (req, reply) => {
    const dev_eui = req.params.dev_eui.toUpperCase();
    const reg = await getDevice(dev_eui);
    const { rows } = await pool.query(
      `SELECT * FROM uplinks
        WHERE device_eui = $1
        ORDER BY timestamp DESC
        LIMIT 1`,
      [dev_eui],
    );
    if (!reg && rows.length === 0) {
      return reply.code(404).send({ error: 'device not found' });
    }
    return {
      device: { ...(reg ?? {}), dev_eui },
      last_uplink: rows[0] ?? null,
    };
  });

  app.get<{
    Params: { dev_eui: string };
    Querystring: { hours?: string };
  }>('/devices/:dev_eui/metrics', async (req) => {
    const dev_eui = req.params.dev_eui.toUpperCase();
    const hours = Math.min(Math.max(parseInt(req.query.hours ?? '24', 10) || 24, 1), 24 * 7);
    const from = new Date(Date.now() - hours * 3_600_000).toISOString();
    const bucket = hours <= 6 ? '5 minutes' : hours <= 48 ? '15 minutes' : '1 hour';
    const { rows } = await pool.query<{
      bucket: string;
      rssi_avg: number | null;
      snr_avg: number | null;
      uplinks: string;
    }>(
      `WITH slots AS (
         SELECT generate_series(
           time_bucket($3::interval, $2::timestamptz),
           time_bucket($3::interval, now()),
           $3::interval
         ) AS bucket
       ),
       agg AS (
         SELECT time_bucket($3::interval, timestamp) AS bucket,
                avg(best_rssi) AS rssi_avg,
                avg(best_snr)  AS snr_avg,
                count(*)       AS uplinks
           FROM uplinks
          WHERE device_eui = $1 AND timestamp >= $2
          GROUP BY bucket
       )
       SELECT slots.bucket,
              agg.rssi_avg,
              agg.snr_avg,
              COALESCE(agg.uplinks, 0)::bigint AS uplinks
         FROM slots LEFT JOIN agg USING (bucket)
        ORDER BY slots.bucket ASC`,
      [dev_eui, from, bucket],
    );
    return {
      dev_eui,
      from,
      bucket,
      points: rows.map((r) => ({
        bucket: r.bucket,
        rssi_avg: r.rssi_avg,
        snr_avg:  r.snr_avg,
        uplinks:  Number(r.uplinks),
      })),
    };
  });

  app.get<{
    Params: { dev_eui: string };
    Querystring: { from?: string; to?: string; limit?: string };
  }>('/devices/:dev_eui/uplinks', async (req) => {
    const dev_eui = req.params.dev_eui.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10) || 200, 1000);
    const args: unknown[] = [dev_eui];
    const clauses: string[] = ['device_eui = $1'];
    if (req.query.from) { args.push(req.query.from); clauses.push(`timestamp >= $${args.length}`); }
    if (req.query.to)   { args.push(req.query.to);   clauses.push(`timestamp <= $${args.length}`); }
    args.push(limit);
    const { rows } = await pool.query(
      `SELECT *
         FROM uplinks
        WHERE ${clauses.join(' AND ')}
        ORDER BY timestamp DESC
        LIMIT $${args.length}`,
      args,
    );
    return { items: rows };
  });
}
