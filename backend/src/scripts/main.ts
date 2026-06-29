/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { statSync } from 'fs';
import fastify from 'fastify';
import { APP_VERSION, loadConfiguration } from 'scripts/conf/config';
import declareRoutes from 'scripts/conf/routes';
import registerStatic from 'scripts/conf/static';
import { openDatabase } from 'scripts/db/connection';
import { createLogger, loggerOptions } from 'scripts/lib/logger';
import startRetentionScheduler from 'scripts/lib/retention';

/**
 * Application entry point: load config, open the database, wire routes, and start serving.
 */
async function start(): Promise<void> {
  const config = loadConfiguration();
  const logger = createLogger(config.logLevel);

  const db = openDatabase(config.databasePath, logger);
  const stopRetention = startRetentionScheduler(db, config, logger);

  const instance = fastify({
    // Webhook payloads with many gateways can be sizeable; keep a generous but bounded limit.
    bodyLimit: 262_144,
    logger: loggerOptions(config.logLevel),
  });

  declareRoutes(instance, db, config, logger);
  await registerStatic(instance, config.publicDir, logger);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down.');
    stopRetention();
    instance.close().then(() => {
      db.close();
      process.exit(0);
    }).catch((error: unknown) => {
      logger.error({ err: error }, 'Error during shutdown.');
      process.exit(1);
    });
  };
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  await instance.listen({ port: config.port, host: '0.0.0.0' });

  let dbSizeMb = 0;
  try {
    dbSizeMb = Math.round((statSync(config.databasePath).size / (1024 * 1024)) * 10) / 10;
  } catch {
    // Database file may not exist until the first write.
  }
  const uplinks = (db.prepare('SELECT COUNT(*) AS count FROM uplinks').get() as { count: number }).count;
  logger.info({
    version: APP_VERSION, port: config.port, dbSizeMb, uplinks,
  }, 'Ready.');
}

start().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', error);
  process.exit(1);
});
