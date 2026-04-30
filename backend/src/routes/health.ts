import type { FastifyInstance } from 'fastify';
import { checkDb } from '../db.js';
import { checkRedis } from '../redis.js';
import { config } from '../config.js';

const startedAt = new Date();
const VERSION = process.env.npm_package_version ?? '0.1.0';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
    return {
      ok: db && redis,
      service: 'noc-core',
      version: VERSION,
      startedAt: startedAt.toISOString(),
      uptime_s: Math.round((Date.now() - startedAt.getTime()) / 1000),
      dependencies: {
        database: db ? 'ok' : 'down',
        redis: redis ? 'ok' : 'down',
        tts: config.tts.baseUrl ? 'configured' : 'not_configured',
        wmc: config.wmc.baseUrl ? 'configured' : 'not_configured',
        ml_service: config.ml.deployed ? 'configured' : 'not_deployed',
      },
    };
  });
}
