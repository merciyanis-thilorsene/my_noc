import { pool } from '../db.js';
import { listDeviceEuis, listGatewayEuis } from '../cache/registry.js';
import { logger } from '../logger.js';
import { clearAlert, raiseAlert } from './broadcast.js';
import { thresholds } from './thresholds.js';
import { runAppRules } from '../apps/index.js';

export async function evaluateAll(): Promise<void> {
  const started = Date.now();
  await Promise.all([evaluateGatewayRules(), evaluateDeviceRules(), runAppRules()]);
  logger.debug({ ms: Date.now() - started }, 'alert engine evaluated');
}

type LatestKpi = {
  gateway_eui: string;
  connection_status: string | null;
  cpu_pct: number | null;
  ram_pct: number | null;
  temperature_c: number | null;
  timestamp: string;
};

export async function evaluateGatewayRules(): Promise<void> {
  const euis = await listGatewayEuis();
  if (euis.length === 0) return;

  const { rows } = await pool.query<LatestKpi>(
    `SELECT DISTINCT ON (gateway_eui)
            gateway_eui, connection_status, cpu_pct, ram_pct, temperature_c, timestamp
       FROM gateway_kpis
      WHERE gateway_eui = ANY($1)
      ORDER BY gateway_eui, timestamp DESC`,
    [euis],
  );
  const byEui = new Map(rows.map((r) => [r.gateway_eui, r]));

  for (const eui of euis) {
    const kpi = byEui.get(eui);

    // gateway_unreachable — keyed off WMC-reported status
    const status = (kpi?.connection_status ?? '').toUpperCase();
    if (status === 'UNREACHABLE' || status === 'DISCONNECTED' || status === 'OFFLINE') {
      await raiseAlert({
        severity: 'critical', source: 'WMC',
        entity_type: 'gateway', entity_id: eui,
        rule_name: 'gateway_unreachable',
        message: `Gateway ${eui} unreachable`,
        details: { status: kpi?.connection_status, last_kpi_at: kpi?.timestamp },
      });
    } else if (status === 'OPERATIONAL' || status === 'CONNECTED') {
      await clearAlert('gateway', eui, 'gateway_unreachable');
    }

    // gateway_high_temp
    if (kpi?.temperature_c != null && kpi.temperature_c > thresholds.gateway_high_temp_c) {
      await raiseAlert({
        severity: 'warning', source: 'WMC',
        entity_type: 'gateway', entity_id: eui,
        rule_name: 'gateway_high_temp',
        message: `Gateway ${eui} temperature ${kpi.temperature_c.toFixed(1)}°C exceeds ${thresholds.gateway_high_temp_c}°C`,
        details: { temperature_c: kpi.temperature_c },
      });
    } else if (kpi?.temperature_c != null) {
      await clearAlert('gateway', eui, 'gateway_high_temp');
    }

    // gateway_high_cpu
    if (kpi?.cpu_pct != null && kpi.cpu_pct > thresholds.gateway_high_cpu_pct) {
      await raiseAlert({
        severity: 'warning', source: 'WMC',
        entity_type: 'gateway', entity_id: eui,
        rule_name: 'gateway_high_cpu',
        message: `Gateway ${eui} CPU ${kpi.cpu_pct.toFixed(0)}% exceeds ${thresholds.gateway_high_cpu_pct}%`,
        details: { cpu_pct: kpi.cpu_pct },
      });
    } else if (kpi?.cpu_pct != null) {
      await clearAlert('gateway', eui, 'gateway_high_cpu');
    }

    // gateway_high_ram
    if (kpi?.ram_pct != null && kpi.ram_pct > thresholds.gateway_high_ram_pct) {
      await raiseAlert({
        severity: 'warning', source: 'WMC',
        entity_type: 'gateway', entity_id: eui,
        rule_name: 'gateway_high_ram',
        message: `Gateway ${eui} RAM ${kpi.ram_pct.toFixed(0)}% exceeds ${thresholds.gateway_high_ram_pct}%`,
        details: { ram_pct: kpi.ram_pct },
      });
    } else if (kpi?.ram_pct != null) {
      await clearAlert('gateway', eui, 'gateway_high_ram');
    }
  }
}

type DeviceStats = {
  device_eui: string;
  last_seen: string | null;
  rssi_avg: number | null;
  uplink_count: string;
};

export async function evaluateDeviceRules(): Promise<void> {
  const euis = await listDeviceEuis();
  if (euis.length === 0) return;

  const { rows } = await pool.query<DeviceStats>(
    `WITH latest AS (
       SELECT DISTINCT ON (device_eui) device_eui, timestamp AS last_seen
         FROM uplinks
        WHERE device_eui = ANY($1)
        ORDER BY device_eui, timestamp DESC
     ),
     rolling AS (
       SELECT device_eui,
              avg(best_rssi) AS rssi_avg,
              count(*) AS uplink_count
         FROM uplinks
        WHERE device_eui = ANY($1) AND timestamp > now() - INTERVAL '1 hour'
        GROUP BY device_eui
     )
     SELECT latest.device_eui, latest.last_seen,
            rolling.rssi_avg,
            COALESCE(rolling.uplink_count, 0)::bigint AS uplink_count
       FROM latest LEFT JOIN rolling USING (device_eui)`,
    [euis],
  );
  const byEui = new Map(rows.map((r) => [r.device_eui, r]));
  const silentMs = thresholds.device_silent_minutes * 60_000;

  for (const eui of euis) {
    const r = byEui.get(eui);

    // device_silent — never seen or stale
    if (!r || !r.last_seen) {
      await raiseAlert({
        severity: 'warning', source: 'DERIVED',
        entity_type: 'device', entity_id: eui,
        rule_name: 'device_silent',
        message: `Device ${eui} has never sent an uplink`,
      });
      continue;
    }
    const ageMs = Date.now() - new Date(r.last_seen).getTime();
    if (ageMs > silentMs) {
      await raiseAlert({
        severity: 'warning', source: 'DERIVED',
        entity_type: 'device', entity_id: eui,
        rule_name: 'device_silent',
        message: `Device ${eui} silent for ${Math.round(ageMs / 60_000)} min`,
        details: { last_seen: r.last_seen, age_minutes: Math.round(ageMs / 60_000) },
      });
    } else {
      await clearAlert('device', eui, 'device_silent');
    }

    // device_poor_signal — average RSSI over last hour
    const samples = Number(r.uplink_count);
    if (
      r.rssi_avg != null &&
      samples >= thresholds.device_poor_signal_min_samples &&
      r.rssi_avg < thresholds.device_poor_signal_rssi
    ) {
      await raiseAlert({
        severity: 'warning', source: 'DERIVED',
        entity_type: 'device', entity_id: eui,
        rule_name: 'device_poor_signal',
        message: `Device ${eui} avg RSSI ${r.rssi_avg.toFixed(1)} dBm over last ${thresholds.device_poor_signal_window_hours}h (n=${samples})`,
        details: { rssi_avg: r.rssi_avg, samples },
      });
    } else if (r.rssi_avg != null) {
      await clearAlert('device', eui, 'device_poor_signal');
    }
  }
}
