/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { packetLossByDevice } from 'scripts/api/deviceMetrics';
import { buildSeries } from 'scripts/api/metricsEngine';
import { parseRange } from 'scripts/lib/time';

/**
 * Computes the mean of non-null numbers, or `null` when none are present.
 */
function meanOrNull(values: (number | null)[]): number | null {
  const defined = values.filter((v): v is number => v !== null);
  if (defined.length === 0) {
    return null;
  }
  return defined.reduce((acc, v) => acc + v, 0) / defined.length;
}

/**
 * Registers the fleet-wide 24h overview endpoint for the landing page KPI strip.
 */
export default function registerOverviewRoutes(instance: FastifyInstance, db: Db): void {
  instance.get('/api/overview', () => {
    const range = parseRange('24h', undefined, Date.now());

    const totalDevices = (db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }).count;
    const activeDevices = (db.prepare(
      'SELECT COUNT(DISTINCT dev_eui) AS count FROM uplinks WHERE timestamp >= @from AND timestamp < @to',
    ).get(range) as { count: number }).count;
    const totalUplinks = (db.prepare(
      'SELECT COUNT(*) AS count FROM uplinks WHERE timestamp >= @from AND timestamp < @to',
    ).get(range) as { count: number }).count;
    const rf = db.prepare(
      'SELECT AVG(best_rssi) AS rssi, AVG(best_snr) AS snr FROM uplinks WHERE timestamp >= @from AND timestamp < @to',
    ).get(range) as { rssi: number | null; snr: number | null };

    // Resolve downlink lifecycle groups to terminal states for accurate counts.
    const downlinkRows = db.prepare(
      'SELECT correlation_ids, event_type FROM downlinks WHERE timestamp >= @from AND timestamp < @to',
    ).all(range) as { correlation_ids: string | null; event_type: string }[];
    const groups = new Map<string, Set<string>>();
    downlinkRows.forEach((row) => {
      const key = row.correlation_ids ?? '';
      const states = groups.get(key);
      if (states === undefined) groups.set(key, new Set([row.event_type]));
      else states.add(row.event_type);
    });
    let ack = 0;
    let resolved = 0;
    [...groups.values()].forEach((states) => {
      if (states.has('ack')) {
        ack += 1;
        resolved += 1;
      } else if (states.has('failed') || states.has('nack')) {
        resolved += 1;
      }
    });

    const lossRates = [...packetLossByDevice(db, range).values()];
    const avgLoss = meanOrNull(lossRates);

    return {
      total_devices: totalDevices,
      active_devices_24h: activeDevices,
      silent_devices_24h: Math.max(0, totalDevices - activeDevices),
      total_uplinks_24h: totalUplinks,
      total_downlinks_24h: groups.size,
      downlink_success_rate_24h: resolved === 0 ? null : ack / resolved,
      avg_packet_loss_pct: avgLoss === null ? null : avgLoss * 100,
      avg_rssi: rf.rssi,
      avg_snr: rf.snr,
      uplinks_per_hour_24h: buildSeries(db, 'uplink_count', range, '1h', null).series,
    };
  });
}
