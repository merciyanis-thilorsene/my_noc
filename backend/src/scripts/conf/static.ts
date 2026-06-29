/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import fastifyStatic from '@fastify/static';
import { type FastifyInstance } from 'fastify';
import { type Logger } from 'scripts/lib/logger';

/**
 * Serves the built React frontend from `publicDir` with a SPA fallback: any non-API GET
 * that doesn't match a file returns `index.html` so client-side routing works. No-op when
 * the directory is absent (API-only deployments / local backend dev).
 */
export default async function registerStatic(
  instance: FastifyInstance,
  publicDir: string,
  logger: Logger,
): Promise<void> {
  const root = resolve(publicDir);
  if (!existsSync(root)) {
    logger.warn({ root }, 'Static frontend directory not found; serving API only.');
    return;
  }

  await instance.register(fastifyStatic, { root, wildcard: false });

  instance.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api') || request.url.startsWith('/webhooks');
    if (request.method === 'GET' && !isApi) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'NOT_FOUND' });
  });

  logger.info({ root }, 'Serving static frontend with SPA fallback.');
}
