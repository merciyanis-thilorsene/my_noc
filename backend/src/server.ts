import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { runMigrations } from './migrate.js';
import { requireApiKey } from './auth/apiKey.js';
import { startPollers, stopPollers } from './pollers/scheduler.js';

import { healthRoutes } from './routes/health.js';
import { overviewRoutes } from './routes/overview.js';
import { gatewayRoutes } from './routes/gateways.js';
import { deviceRoutes } from './routes/devices.js';
import { alertRoutes } from './routes/alerts.js';
import { predictionRoutes } from './routes/predictions.js';
import { trafficRoutes } from './routes/traffic.js';
import { webhookRoutes } from './routes/webhook.js';
import { ledsRoutes } from './apps/leds/index.js';
import { liveWs } from './ws/live.js';

async function main(): Promise<void> {
  await runMigrations();

  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cors, { origin: config.frontend.corsOrigins });
  await app.register(websocket);

  // Public (unauthenticated) — health for uptime checks, webhook for TTS.
  await app.register(healthRoutes,  { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  // Authenticated REST — dashboard surface.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireApiKey);
    await scope.register(overviewRoutes,    { prefix: '/api' });
    await scope.register(gatewayRoutes,     { prefix: '/api' });
    await scope.register(deviceRoutes,      { prefix: '/api' });
    await scope.register(alertRoutes,       { prefix: '/api' });
    await scope.register(predictionRoutes,  { prefix: '/api' });
    await scope.register(trafficRoutes,     { prefix: '/api' });
    await scope.register(ledsRoutes,        { prefix: '/api' });
  });

  // WebSocket (token auth at handshake).
  await app.register(liveWs, { prefix: '/ws' });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      stopPollers();
      await app.close();
      await pool.end();
      redis.disconnect();
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: config.host, port: config.port });
    startPollers();
  } catch (err) {
    app.log.fatal({ err }, 'listen failed');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failure');
  process.exit(1);
});
