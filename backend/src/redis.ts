import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 200, 5_000),
});

redis.on('error', (err: unknown) => {
  logger.error({ err }, 'redis error');
});

export async function checkRedis(): Promise<boolean> {
  try {
    const res = await redis.ping();
    return res === 'PONG';
  } catch (err) {
    logger.error({ err }, 'redis check failed');
    return false;
  }
}
