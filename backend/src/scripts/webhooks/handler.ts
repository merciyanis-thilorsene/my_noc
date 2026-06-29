/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { timingSafeEqual } from 'crypto';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { type Logger } from 'scripts/lib/logger';
import handleUplink from 'scripts/webhooks/uplink';
import handleJoin from 'scripts/webhooks/join';
import handleDownlink from 'scripts/webhooks/downlink';
import { type TtsWebhookPayload } from 'scripts/webhooks/tts';

const SECRET_HEADER = 'x-tts-webhook-secret';

/**
 * Dependencies a webhook route needs.
 */
export interface WebhookDeps {
  db: Db;
  logger: Logger;
  webhookSecret: string;
}

/**
 * Constant-time comparison of the provided header against the configured secret.
 */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A normalizer that persists one event type and reports whether it was processable.
 */
type EventHandler = (db: Db, payload: TtsWebhookPayload, receivedAt: string) => boolean;

/**
 * Builds a Fastify handler for a given event type: validates the secret, normalizes, and
 * persists synchronously. Returns 200 on success, 401 on bad secret, 400 on an
 * unprocessable payload (retrying won't help), and 500 on unexpected errors (TTS retries).
 */
function makeHandler(deps: WebhookDeps, kind: string, handle: EventHandler) {
  return (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const provided = request.headers[SECRET_HEADER];
    if (!secretMatches(Array.isArray(provided) ? provided[0] : provided, deps.webhookSecret)) {
      deps.logger.warn({ kind }, 'Rejected webhook with invalid secret.');
      return reply.status(401).send({ error: 'INVALID_SECRET' });
    }
    try {
      const payload = request.body as TtsWebhookPayload;
      const processed = handle(deps.db, payload, new Date().toISOString());
      if (!processed) {
        deps.logger.warn({ kind, body: request.body }, 'Unprocessable webhook payload.');
        return reply.status(400).send({ error: 'UNPROCESSABLE_PAYLOAD' });
      }
      deps.logger.debug({ kind }, 'Processed webhook.');
      return reply.status(200).send();
    } catch (error) {
      deps.logger.error({ kind, err: error, body: request.body }, 'Failed to process webhook.');
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  };
}

/**
 * Registers the three webhook ingest endpoints on the Fastify instance.
 */
export function registerWebhookRoutes(instance: FastifyInstance, deps: WebhookDeps): void {
  instance.post('/webhooks/uplink', makeHandler(deps, 'uplink', handleUplink));
  instance.post('/webhooks/join', makeHandler(deps, 'join', handleJoin));
  instance.post('/webhooks/downlink', makeHandler(deps, 'downlink', handleDownlink));
}
