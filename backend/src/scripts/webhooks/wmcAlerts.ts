/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { timingSafeEqual } from 'crypto';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { type Logger } from 'scripts/lib/logger';
import { normalizeEui } from 'scripts/webhooks/tts';
import { insertOrUpdateAlert } from 'scripts/db/gatewayQueries';

const SECRET_HEADER = 'x-wmc-webhook-secret';

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
 * Reads the first string present among the given keys of an object.
 */
function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  const key = keys.find((candidate) => typeof source[candidate] === 'string');
  return key === undefined ? null : source[key] as string;
}

/**
 * Extracts the alert fields from a WMC webhook body. WMC's outbound alert payload shape is not
 * yet confirmed (§B.3), so this reads a defensive set of likely field names; the full body is
 * always persisted in `raw` so nothing is lost while the mapping is finalized. Returns `null`
 * when the minimum identifiers (gateway EUI, alert type, raised-at) can't be found.
 */
function parseAlert(body: Record<string, unknown>, receivedAt: string): {
  gwEui: string;
  alertType: string;
  severity: string | null;
  raisedAt: string;
  clearedAt: string | null;
} | null {
  const gateway = (body.gateway ?? {}) as Record<string, unknown>;
  const rawEui = firstString(body, ['gwEui', 'gateway_eui', 'gatewayEui'])
    ?? firstString(gateway, ['eui', 'gwEui']);
  const gwEui = normalizeEui(rawEui ?? undefined);
  const alertType = firstString(body, ['alertType', 'alert_type', 'type', 'name']);
  if (gwEui === null || alertType === null) {
    return null;
  }
  return {
    gwEui,
    alertType,
    severity: firstString(body, ['severity', 'level']),
    raisedAt: firstString(body, ['raisedAt', 'raised_at', 'time', 'timestamp']) ?? receivedAt,
    clearedAt: firstString(body, ['clearedAt', 'cleared_at']),
  };
}

/**
 * Builds the alerts webhook handler: validate the shared secret, parse defensively, and
 * upsert (dedup on `(gw_eui, alert_type, raised_at)`). 401 on a bad secret, 400 on an
 * unprocessable body, 200 on success.
 */
function makeHandler(db: Db, logger: Logger, secret: string) {
  return (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const provided = request.headers[SECRET_HEADER];
    if (!secretMatches(Array.isArray(provided) ? provided[0] : provided, secret)) {
      logger.warn('Rejected WMC alert webhook with invalid secret.');
      return reply.status(401).send({ error: 'INVALID_SECRET' });
    }
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const alert = parseAlert(body, new Date().toISOString());
      if (alert === null) {
        logger.warn({ body }, 'Unprocessable WMC alert payload.');
        return reply.status(400).send({ error: 'UNPROCESSABLE_PAYLOAD' });
      }
      insertOrUpdateAlert(db, { ...alert, raw: JSON.stringify(body) });
      return reply.status(200).send();
    } catch (error) {
      logger.error({ err: error }, 'Failed to process WMC alert webhook.');
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  };
}

/**
 * Registers the WMC alerts ingest endpoint. No-op when no secret is configured — the endpoint
 * is only exposed once WMC_ALERTS_WEBHOOK_SECRET is set on both ends.
 *
 * @param instance Fastify instance.
 *
 * @param db Database connection.
 *
 * @param logger Logger instance.
 *
 * @param secret Shared webhook secret, or `null` to leave the endpoint disabled.
 */
export default function registerWmcAlertsRoute(
  instance: FastifyInstance,
  db: Db,
  logger: Logger,
  secret: string | null,
): void {
  if (secret === null) {
    return;
  }
  instance.post('/webhooks/wmc/alerts', makeHandler(db, logger, secret));
}
