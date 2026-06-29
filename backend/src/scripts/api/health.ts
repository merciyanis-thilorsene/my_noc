/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { statSync } from 'fs';
import { type FastifyInstance } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { APP_VERSION, type Configuration } from 'scripts/conf/config';
import { toIso } from 'scripts/lib/time';

/**
 * Returns the on-disk size of the database in MB, including the WAL sidecar, or 0 if absent.
 */
function databaseSizeMb(databasePath: string): number {
  const bytes = ['', '-wal', '-shm'].reduce((total, suffix) => {
    try {
      return total + statSync(`${databasePath}${suffix}`).size;
    } catch {
      // File may not exist yet; ignore.
      return total;
    }
  }, 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/**
 * Registers the health endpoint, reporting DB size, event counts, and uptime.
 */
export default function registerHealthRoutes(
  instance: FastifyInstance,
  db: Db,
  config: Configuration,
): void {
  const totalStmt = db.prepare('SELECT COUNT(*) AS count FROM uplinks');
  const lastHourStmt = db.prepare('SELECT COUNT(*) AS count FROM uplinks WHERE timestamp >= @since');

  instance.get('/api/health', () => {
    const total = (totalStmt.get() as { count: number }).count;
    const since = toIso(Date.now() - 3_600_000);
    const lastHour = (lastHourStmt.get({ since }) as { count: number }).count;
    return {
      status: 'ok',
      version: APP_VERSION,
      tenant_id: config.ttsTenantId,
      db_path: config.databasePath,
      db_size_mb: databaseSizeMb(config.databasePath),
      uplinks_total: total,
      uplinks_last_hour: lastHour,
      uptime_seconds: Math.round(process.uptime()),
    };
  });
}
