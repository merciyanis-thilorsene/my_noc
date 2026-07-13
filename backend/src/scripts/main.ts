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
import startWmcPoller from 'scripts/lib/wmcPoller';
import WmcClient from 'scripts/lib/wmcClient';
import Geocoder from 'scripts/lib/geocoder';
import { createSessionSecret, LoginThrottle } from 'scripts/lib/auth';

/**
 * Application entry point: load config, open the database, wire routes, and start serving.
 */
async function start(): Promise<void> {
  const config = loadConfiguration();
  const logger = createLogger(config.logLevel);

  const db = openDatabase(config.databasePath, logger);
  const stopRetention = startRetentionScheduler(db, config, logger);

  const wmcClient = (
    config.wmcBaseUrl !== null
    && config.wmcLogin !== null
    && config.wmcPassword !== null
  )
    ? new WmcClient(logger, {
      baseUrl: config.wmcBaseUrl,
      login: config.wmcLogin,
      password: config.wmcPassword,
    })
    : null;
  const geocoder = config.geocoderUrl !== null ? new Geocoder(logger, config.geocoderUrl) : null;
  const stopPoller = startWmcPoller(db, wmcClient, config, logger);

  const auth = {
    accessCode: config.accessCode,
    sessionSecret: createSessionSecret(),
    throttle: new LoginThrottle(),
  };
  if (config.accessCode !== null) {
    logger.info('Access-code gate enabled.');
  }

  const instance = fastify({
    // Webhook payloads with many gateways can be sizeable; keep a generous but bounded limit.
    bodyLimit: 262_144,
    // Behind our own Traefik: trust X-Forwarded-* so request.ip is the real client
    // (accurate per-IP login throttling) and X-Forwarded-Proto drives the cookie Secure flag.
    trustProxy: true,
    logger: loggerOptions(config.logLevel),
  });

  declareRoutes(instance, db, config, logger, { wmcClient, geocoder }, auth);
  await registerStatic(instance, config.publicDir, logger);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down.');
    stopRetention();
    stopPoller();
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
