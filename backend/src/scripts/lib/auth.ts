/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import {
  randomBytes, createHmac, timingSafeEqual,
} from 'node:crypto';

/** Name of the session cookie set on a successful access-code login. */
export const SESSION_COOKIE = 'noc_session';

/**
 * Generates a fresh random session-signing secret. Held in memory only, so every process
 * restart invalidates outstanding sessions (operators re-enter the code after a deploy) —
 * the simplest option that needs no persistence.
 */
export function createSessionSecret(): Buffer {
  return randomBytes(32);
}

/**
 * Issues a signed, self-contained session token: `base64url(payload).base64url(HMAC)`, where
 * the payload carries only an expiry. No server-side session store is needed to verify it.
 *
 * @param secret Signing secret.
 *
 * @param ttlMs Lifetime in milliseconds.
 *
 * @returns The session token.
 */
export function issueSession(secret: Buffer, ttlMs: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs }));
  const signature = createHmac('sha256', secret).update(payload).digest();
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

/**
 * Verifies a session token's signature (constant-time) and expiry.
 *
 * @param secret Signing secret.
 *
 * @param token Token from the session cookie.
 *
 * @returns Whether the token is authentic and unexpired.
 */
export function verifySession(secret: Buffer, token: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) {
    return false;
  }
  const payload = Buffer.from(token.slice(0, dot), 'base64url');
  const signature = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return false;
  }
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as { exp?: unknown };
    return typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison (length-guarded so `timingSafeEqual` never throws).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Reads a single cookie value from a `Cookie` header, or `null` when absent.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null;
  }
  const match = header.split(';').find((part) => {
    const eq = part.indexOf('=');
    return eq > 0 && part.slice(0, eq).trim() === name;
  });
  if (match === undefined) {
    return null;
  }
  return decodeURIComponent(match.slice(match.indexOf('=') + 1).trim());
}

/**
 * Builds the `Set-Cookie` value for a session. `Secure` is added only over HTTPS so the
 * cookie still works on a plain-HTTP local run.
 */
export function buildSessionCookie(token: string, secure: boolean, maxAgeSec: number): string {
  const base = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(maxAgeSec)}`;
  return secure ? `${base}; Secure` : base;
}

/**
 * Builds a `Set-Cookie` value that immediately expires the session cookie (logout).
 */
export function buildClearCookie(secure: boolean): string {
  const base = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return secure ? `${base}; Secure` : base;
}

/**
 * A per-IP failed-login throttle: after `maxFails` bad attempts an IP is locked out for
 * `lockMs`. Kept in memory (single-process app); success clears the counter.
 */
export class LoginThrottle {
  protected attempts = new Map<string, { fails: number; lockUntil: number }>();

  protected maxFails: number;

  protected lockMs: number;

  /**
   * @param maxFails Failed attempts before a lockout.
   *
   * @param lockMs Lockout duration in milliseconds.
   */
  public constructor(maxFails = 8, lockMs = 60_000) {
    this.maxFails = maxFails;
    this.lockMs = lockMs;
  }

  /**
   * Returns the current lockout state for an IP.
   */
  public check(ip: string): { locked: boolean; retryAfterSec: number } {
    const entry = this.attempts.get(ip);
    if (entry !== undefined && entry.lockUntil > Date.now()) {
      return { locked: true, retryAfterSec: Math.ceil((entry.lockUntil - Date.now()) / 1000) };
    }
    return { locked: false, retryAfterSec: 0 };
  }

  /**
   * Records a failed attempt, locking the IP once the threshold is reached.
   */
  public fail(ip: string): void {
    const entry = this.attempts.get(ip) ?? { fails: 0, lockUntil: 0 };
    entry.fails += 1;
    if (entry.fails >= this.maxFails) {
      entry.lockUntil = Date.now() + this.lockMs;
      entry.fails = 0;
    }
    this.attempts.set(ip, entry);
  }

  /**
   * Clears an IP's failure state after a successful login.
   */
  public success(ip: string): void {
    this.attempts.delete(ip);
  }
}
