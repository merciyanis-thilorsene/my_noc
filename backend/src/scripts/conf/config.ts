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
  /** TTN/TTS cluster base URL for outbound downlinks, e.g. https://eu1.cloud.thethings.network. */
  ttnBaseUrl: string | null;
  /** API key (downlink-write rights) used to push downlinks; null disables downlinks. */
  ttnDownlinkApiKey: string | null;
  /** Kerlink WMC base URL (no trailing slash), e.g. https://wmc.wanesy.com. Null disables the gateway poller. */
  wmcBaseUrl: string | null;
  /** WMC login (HTTP Basic username for the token endpoint). Null disables the gateway poller. */
  wmcLogin: string | null;
  /** WMC password. Null disables the gateway poller. */
  wmcPassword: string | null;
  /** Seconds between WMC gateway polls. */
  wmcPollIntervalSec: number;
  /** Shared secret WMC sends in the webhook header for pushed gateway alerts; null disables it. */
  wmcAlertsWebhookSecret: string | null;
  /** Nominatim-compatible geocoder base URL for address → coordinates; null disables geocoding. */
  geocoderUrl: string | null;
  /** Map tile URL template served to the frontend Gateways map. */
  mapTileUrl: string;
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
 * Resolves an optional secret from `${name}` or a `${name}_FILE` path. Returns null if unset.
 */
function resolveOptionalSecret(name: string): string | null {
  const direct = env(name);
  if (direct !== undefined) {
    return direct;
  }
  const file = env(`${name}_FILE`);
  if (file !== undefined) {
    return readFileSync(file, 'utf8').trim();
  }
  return null;
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
    ttnBaseUrl: (env('TTN_BASE_URL') ?? '').replace(/\/$/, '') || null,
    ttnDownlinkApiKey: resolveOptionalSecret('TTN_DOWNLINK_API_KEY'),
    wmcBaseUrl: (env('WMC_BASE_URL') ?? '').replace(/\/$/, '') || null,
    wmcLogin: env('WMC_LOGIN') ?? null,
    wmcPassword: resolveOptionalSecret('WMC_PASSWORD'),
    wmcPollIntervalSec: envInt('WMC_POLL_INTERVAL_SEC', 300),
    wmcAlertsWebhookSecret: resolveOptionalSecret('WMC_ALERTS_WEBHOOK_SECRET'),
    geocoderUrl: (env('GEOCODER_URL') ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '') || null,
    mapTileUrl: envOr('MAP_TILE_URL', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
  };
}
