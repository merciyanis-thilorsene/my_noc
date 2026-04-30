import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { getGateway, listGatewayEuis } from '../cache/registry.js';

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gateways', async () => {
    const euis = await listGatewayEuis();
    if (euis.length === 0) return { items: [] };

    const { rows } = await pool.query<{
      gateway_eui: string;
      connection_status: string | null;
      cpu_pct: number | null;
      ram_pct: number | null;
      temperature_c: number | null;
      ping_rtt_ms: number | null;
      last_kpi_at: string | null;
    }>(
      `SELECT DISTINCT ON (gateway_eui)
              gateway_eui, connection_status, cpu_pct, ram_pct, temperature_c,
              ping_rtt_ms, timestamp AS last_kpi_at
         FROM gateway_kpis
        WHERE gateway_eui = ANY($1)
        ORDER BY gateway_eui, timestamp DESC`,
      [euis],
    );
    const kpiByEui = new Map(rows.map((r) => [r.gateway_eui, r]));

    const items = await Promise.all(
      euis.map(async (eui) => {
        const reg = (await getGateway(eui)) ?? {};
        const kpi = kpiByEui.get(eui) ?? {};
        return { ...reg, ...kpi, gateway_eui: eui };
      }),
    );
    return { items };
  });

  app.get<{ Params: { eui: string } }>('/gateways/:eui', async (req, reply) => {
    const eui = req.params.eui.toUpperCase();
    const reg = await getGateway(eui);
    const { rows } = await pool.query(
      `SELECT gateway_eui, connection_status, cpu_pct, ram_pct, temperature_c,
              ping_rtt_ms, backhaul_type, firmware_version, uptime_s,
              timestamp AS last_kpi_at
         FROM gateway_kpis
        WHERE gateway_eui = $1
        ORDER BY timestamp DESC
        LIMIT 1`,
      [eui],
    );
    if (!reg && rows.length === 0) {
      return reply.code(404).send({ error: 'gateway not found' });
    }
    return { gateway: { ...(reg ?? {}), ...(rows[0] ?? {}), gateway_eui: eui } };
  });

  app.get<{
    Params: { eui: string };
    Querystring: { from?: string; to?: string; resolution?: string };
  }>('/gateways/:eui/metrics', async (req) => {
    const eui = req.params.eui.toUpperCase();
    const from = req.query.from ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
    const to = req.query.to ?? new Date().toISOString();
    const { rows } = await pool.query(
      `SELECT bucket, cpu_pct_avg, ram_pct_avg, temperature_c_avg,
              ping_rtt_ms_avg, connection_status
         FROM gateway_metrics_1m
        WHERE gateway_eui = $1 AND bucket BETWEEN $2 AND $3
        ORDER BY bucket ASC`,
      [eui, from, to],
    );
    return { gateway_eui: eui, from, to, points: rows };
  });
}
