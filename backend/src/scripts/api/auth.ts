/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Logger } from 'scripts/lib/logger';
import {
  buildClearCookie,
  buildSessionCookie,
  constantTimeEquals,
  issueSession,
  readCookie,
  verifySession,
  SESSION_COOKIE,
  type LoginThrottle,
} from 'scripts/lib/auth';

/** Session lifetime — operators re-enter the code after this (or after a deploy). */
const SESSION_TTL_SEC = 12 * 3600;

/**
 * `/api` paths that must stay reachable without a session: the health check (Docker probe)
 * and the auth endpoints themselves. Webhooks aren't under `/api` and are never gated.
 */
const EXEMPT = new Set(['/api/health', '/api/login', '/api/logout']);

/**
 * Access-code auth dependencies.
 */
export interface AuthConfig {
  /** The shared access code, or `null` when the gate is disabled. */
  accessCode: string | null;
  /** In-memory session-signing secret. */
  sessionSecret: Buffer;
  /** Failed-login throttle. */
  throttle: LoginThrottle;
}

/** Whether the original client request reached the proxy over HTTPS. */
function isSecure(request: FastifyRequest): boolean {
  return request.headers['x-forwarded-proto'] === 'https';
}

/**
 * Registers the access-code gate and its endpoints:
 * - an `onRequest` hook that 401s gated `/api/*` requests lacking a valid session cookie
 *   (no-op when no code is configured);
 * - `GET /api/session` (gated) — the frontend's auth probe;
 * - `POST /api/login` / `POST /api/logout`.
 *
 * @param instance Fastify instance.
 *
 * @param logger Logger instance.
 *
 * @param auth Auth configuration.
 */
export default function registerAuthRoutes(
  instance: FastifyInstance,
  logger: Logger,
  auth: AuthConfig,
): void {
  const { accessCode, sessionSecret, throttle } = auth;

  instance.addHook('onRequest', (request, reply, done) => {
    if (accessCode === null) {
      done();
      return;
    }
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/') || EXEMPT.has(path)) {
      done();
      return;
    }
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token !== null && verifySession(sessionSecret, token)) {
      done();
      return;
    }
    reply.code(401).send({ error: 'UNAUTHENTICATED' });
  });

  // Reached only when the gate let the request through (valid session, or gate disabled).
  instance.get('/api/session', () => ({ authenticated: true }));

  instance.post('/api/login', (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    if (accessCode === null) {
      return reply.send({ ok: true });
    }
    const { ip } = request;
    const lock = throttle.check(ip);
    if (lock.locked) {
      reply.header('retry-after', String(lock.retryAfterSec));
      return reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS', retry_after: lock.retryAfterSec });
    }
    const { code } = request.body as { code?: unknown };
    if (typeof code === 'string' && constantTimeEquals(code, accessCode)) {
      throttle.success(ip);
      const token = issueSession(sessionSecret, SESSION_TTL_SEC * 1000);
      reply.header('set-cookie', buildSessionCookie(token, isSecure(request), SESSION_TTL_SEC));
      return reply.send({ ok: true });
    }
    throttle.fail(ip);
    logger.warn({ ip }, 'Rejected login with an invalid access code.');
    return reply.code(401).send({ error: 'INVALID_CODE' });
  });

  instance.post('/api/logout', (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    reply.header('set-cookie', buildClearCookie(isSecure(request)));
    return reply.send({ ok: true });
  });
}
