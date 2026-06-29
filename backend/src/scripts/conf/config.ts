/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { readFileSync } from 'fs';

/**
 * Application version, surfaced through the health endpoint.
 */
export const APP_VERSION = '1.0.0';

/**
 * Supported log levels.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Fully resolved, validated application configuration.
 */
export interface Configuration {
  port: number;
  databasePath: string;
  webhookSecret: string;
  ttsTenantId: string | null;
  logLevel: LogLevel;
  retentionDays: number;
  cleanupHourUtc: number;
  publicDir: string;
}

/**
 * Reads an environment variable, falling back to `fallback` when unset or empty.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Like {@link env} but always returns a string, using `fallback` when unset or empty.
 */
function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

/**
 * Parses an integer environment variable, throwing when the value is not a valid number.
 */
function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for ${name}: "${raw}".`);
  }
  return parsed;
}

/**
 * Resolves the webhook shared secret from either WEBHOOK_SECRET or WEBHOOK_SECRET_FILE.
 */
function resolveWebhookSecret(): string {
  const direct = env('WEBHOOK_SECRET');
  if (direct !== undefined) {
    return direct;
  }
  const file = env('WEBHOOK_SECRET_FILE');
  if (file !== undefined) {
    return readFileSync(file, 'utf8').trim();
  }
  throw new Error('Missing required WEBHOOK_SECRET (or WEBHOOK_SECRET_FILE).');
}

/**
 * Loads and validates configuration from the environment. Throws on invalid input.
 */
export function loadConfiguration(): Configuration {
  const logLevel = envOr('LOG_LEVEL', 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: "${logLevel}".`);
  }

  const cleanupHourUtc = envInt('CLEANUP_HOUR_UTC', 3);
  if (cleanupHourUtc < 0 || cleanupHourUtc > 23) {
    throw new Error(`CLEANUP_HOUR_UTC must be between 0 and 23, got ${String(cleanupHourUtc)}.`);
  }

  return {
    port: envInt('PORT', 8080),
    databasePath: envOr('DATABASE_PATH', './data/monitor.db'),
    webhookSecret: resolveWebhookSecret(),
    ttsTenantId: env('TTS_TENANT_ID') ?? null,
    logLevel,
    retentionDays: envInt('RETENTION_DAYS', 180),
    cleanupHourUtc,
    publicDir: envOr('PUBLIC_DIR', './public'),
  };
}
