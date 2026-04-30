import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { listDeviceEuis, listGatewayEuis } from '../cache/registry.js';

export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/overview', async () => {
    const [gwEuis, devEuis, uplinksRow, activeAlerts, gatewayStatuses, rfStats, sfRows] = await Promise.all([
      listGatewayEuis(),
      listDeviceEuis(),
      pool.query<{ count: string }>(
        `SELECT count(*)::bigint AS count
           FROM uplinks
          WHERE timestamp > now() - INTERVAL '1 minute'`,
      ),
      pool.query<{ severity: string; count: string }>(
        `SELECT severity, count(*)::bigint AS count
           FROM alerts
          WHERE cleared_at IS NULL
          GROUP BY severity`,
      ),
      pool.query<{ gateway_eui: string; connection_status: string | null }>(
        `SELECT DISTINCT ON (gateway_eui) gateway_eui, connection_status
           FROM gateway_kpis
          WHERE timestamp > now() - INTERVAL '1 hour'
          ORDER BY gateway_eui, timestamp DESC`,
      ),
      pool.query<{ rssi_avg: number | null; snr_avg: number | null; sample_count: string }>(
        `SELECT avg(best_rssi) AS rssi_avg,
                avg(best_snr)  AS snr_avg,
                count(*)::bigint AS sample_count
           FROM uplinks
          WHERE timestamp > now() - INTERVAL '1 hour'`,
      ),
      pool.query<{ sf: number; count: string }>(
        `SELECT sf, count(*)::bigint AS count
           FROM uplinks
          WHERE timestamp > now() - INTERVAL '1 hour' AND sf BETWEEN 7 AND 12
          GROUP BY sf
          ORDER BY sf`,
      ),
    ]);

    // Gateway status rollup from latest WMC row; missing → unknown.
    const statusByEui = new Map(
      gatewayStatuses.rows.map((r) => [r.gateway_eui, r.connection_status]),
    );
    let operational = 0;
    let unreachable = 0;
    let unknown = 0;
    for (const eui of gwEuis) {
      const s = (statusByEui.get(eui) ?? '').toUpperCase();
      if (s === 'OPERATIONAL' || s === 'CONNECTED') operational += 1;
      else if (s === 'UNREACHABLE' || s === 'DISCONNECTED' || s === 'OFFLINE') unreachable += 1;
      else unknown += 1;
    }

    // Device "active" = seen in last hour. Keeps the definition simple for
    // Phase 1; refined alerting lives in Commit C.
    let activeN = 0;
    if (devEuis.length > 0) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(DISTINCT device_eui)::bigint AS n
           FROM uplinks
          WHERE device_eui = ANY($1) AND timestamp > now() - INTERVAL '1 hour'`,
        [devEuis],
      );
      activeN = Number(rows[0]?.n ?? 0);
    }

    const alertsBySeverity: Record<'info' | 'warning' | 'critical', number> = {
      info: 0, warning: 0, critical: 0,
    };
    for (const row of activeAlerts.rows) {
      if (row.severity in alertsBySeverity) {
        alertsBySeverity[row.severity as keyof typeof alertsBySeverity] = Number(row.count);
      }
    }
    const alertsTotal = alertsBySeverity.info + alertsBySeverity.warning + alertsBySeverity.critical;

    // Fleet-wide RF health from the last hour of uplinks (same formula as per-device).
    const rssiAvg = rfStats.rows[0]?.rssi_avg;
    const snrAvg  = rfStats.rows[0]?.snr_avg;
    const rfSamples = Number(rfStats.rows[0]?.sample_count ?? 0);
    const rfHealth = rfQuality(
      typeof rssiAvg === 'number' ? rssiAvg : null,
      typeof snrAvg  === 'number' ? snrAvg  : null,
    );

    // SF distribution: SF7..SF12 with count + percentage.
    const sfTotal = sfRows.rows.reduce((a, r) => a + Number(r.count), 0);
    const sfMap = new Map(sfRows.rows.map((r) => [r.sf, Number(r.count)]));
    const sfDistribution = [7, 8, 9, 10, 11, 12].map((sf) => {
      const count = sfMap.get(sf) ?? 0;
      return {
        sf,
        count,
        pct: sfTotal > 0 ? Math.round((count / sfTotal) * 1000) / 10 : 0,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      fleet: {
        gateways: { operational, unreachable, unknown, total: gwEuis.length },
        devices: {
          active: activeN,
          inactive: Math.max(0, devEuis.length - activeN),
          low_battery: 0,
          silent: 0,
          total: devEuis.length,
        },
      },
      traffic: { uplinks_last_minute: Number(uplinksRow.rows[0]?.count ?? 0) },
      alerts: { by_severity: alertsBySeverity, total: alertsTotal },
      network_health_score: computeHealth(operational, gwEuis.length, alertsBySeverity),
      rf: {
        health_score: rfHealth,                    // 0..100, null when no uplinks yet
        rssi_avg: rssiAvg ?? null,                 // dBm
        snr_avg:  snrAvg  ?? null,                 // dB
        samples:  rfSamples,                       // uplinks considered (last 1h)
      },
      sf_distribution: sfDistribution,
    };
  });
}

function rfQuality(rssi: number | null, snr: number | null): number | null {
  if (rssi == null && snr == null) return null;
  const clamp = (x: number): number => Math.max(0, Math.min(100, x));
  const rScore = rssi != null ? clamp(((rssi - (-130)) / 60) * 100) : null;
  const sScore = snr  != null ? clamp(((snr  - (-20)) / 30)  * 100) : null;
  const combined = rScore != null && sScore != null ? (rScore + sScore) / 2 : (rScore ?? sScore)!;
  return Math.round(combined * 10) / 10;
}

function computeHealth(
  operational: number,
  totalGateways: number,
  alerts: { info: number; warning: number; critical: number },
): number {
  if (totalGateways === 0) return 100;
  const base = Math.round((operational / totalGateways) * 100);
  const penalty = alerts.critical * 15 + alerts.warning * 5;
  return Math.max(0, Math.min(100, base - penalty));
}
