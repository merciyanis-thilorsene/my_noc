/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { deleteOlderThan } from 'scripts/db/queries';
import { type Configuration } from 'scripts/conf/config';
import { type Logger } from 'scripts/lib/logger';
import { toIso } from 'scripts/lib/time';

const DAY_MS = 86_400_000;

/**
 * Milliseconds from `now` until the next occurrence of `hourUtc:00:00`.
 */
function msUntilNextRun(now: Date, hourUtc: number): number {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setTime(next.getTime() + DAY_MS);
  }
  return next.getTime() - now.getTime();
}

/**
 * Runs one retention pass: delete expired events, optimize, and VACUUM on Sundays (UTC).
 */
function runCleanup(db: Db, config: Configuration, logger: Logger): void {
  const cutoff = toIso(Date.now() - config.retentionDays * DAY_MS);
  const deleted = deleteOlderThan(db, cutoff);
  db.pragma('optimize');
  if (new Date().getUTCDay() === 0) {
    db.exec('VACUUM');
    logger.info('Ran weekly VACUUM.');
  }
  logger.info({ cutoff, ...deleted }, 'Retention cleanup complete.');
}

/**
 * Starts the daily retention scheduler. Returns a function that cancels all pending timers.
 */
export default function startRetentionScheduler(
  db: Db,
  config: Configuration,
  logger: Logger,
): () => void {
  let intervalTimer: NodeJS.Timeout | undefined;
  const initialDelay = msUntilNextRun(new Date(), config.cleanupHourUtc);

  const startTimer = setTimeout(() => {
    runCleanup(db, config, logger);
    intervalTimer = setInterval(() => { runCleanup(db, config, logger); }, DAY_MS);
  }, initialDelay);

  logger.info({ hourUtc: config.cleanupHourUtc, inMs: initialDelay }, 'Retention scheduler armed.');

  return () => {
    clearTimeout(startTimer);
    if (intervalTimer !== undefined) {
      clearInterval(intervalTimer);
    }
  };
}
