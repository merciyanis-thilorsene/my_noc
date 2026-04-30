import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export async function requireApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !config.frontend.apiKeys.has(token)) {
    reply.code(401).send({ error: 'unauthorized' });
  }
}
