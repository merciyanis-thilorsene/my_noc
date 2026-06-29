/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Supported time-bucket sizes and their width in seconds.
 *
 * Weeks and months use fixed widths (7d / 30d) rather than calendar boundaries so that
 * bucketing is a simple, index-stable epoch division both in SQL and in JS.
 */
export const BUCKET_SECONDS = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
  '1w': 604800,
  '1mo': 2592000,
} as const;

/**
 * A valid bucket identifier.
 */
export type Bucket = keyof typeof BUCKET_SECONDS;

/**
 * A resolved, inclusive-exclusive time range expressed in ISO 8601 UTC.
 */
export interface TimeRange {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
}

const RELATIVE_PATTERN = /^(\d+)(m|h|d|w|mo)$/;

const RELATIVE_UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
};

/**
 * Formats a millisecond epoch as an ISO 8601 UTC string (without milliseconds).
 */
export function toIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Parses a single bound that may be absolute (ISO 8601) or relative (e.g. `24h`, `7d`),
 * resolving relative values backwards from `nowMs`. Returns `null` when unparseable.
 */
function parseBound(value: string | undefined, nowMs: number): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  const relative = RELATIVE_PATTERN.exec(value);
  if (relative !== null) {
    const amount = Number.parseInt(relative[1], 10);
    return nowMs - amount * RELATIVE_UNIT_MS[relative[2]];
  }
  const absolute = Date.parse(value);
  return Number.isNaN(absolute) ? null : absolute;
}

/**
 * Resolves `from`/`to` query params into a concrete range. Defaults to the last 24 hours.
 */
export function parseRange(
  from: string | undefined,
  to: string | undefined,
  nowMs: number,
): TimeRange {
  const toMs = parseBound(to, nowMs) ?? nowMs;
  const fromMs = parseBound(from, nowMs) ?? toMs - RELATIVE_UNIT_MS.h * 24;
  return {
    from: toIso(fromMs), to: toIso(toMs), fromMs, toMs,
  };
}

/**
 * Auto-selects a bucket size for a range, targeting a readable number of points per chart.
 */
export function autoBucket(fromMs: number, toMs: number): Bucket {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 6) return '5m';
  if (hours <= 24) return '15m';
  if (hours <= 24 * 7) return '1h';
  if (hours <= 24 * 30) return '6h';
  if (hours <= 24 * 90) return '1d';
  return '1w';
}

/**
 * Validates and resolves an explicit bucket param, falling back to {@link autoBucket}.
 */
export function resolveBucket(bucket: string | undefined, fromMs: number, toMs: number): Bucket {
  if (bucket !== undefined && bucket in BUCKET_SECONDS) {
    return bucket as Bucket;
  }
  return autoBucket(fromMs, toMs);
}

/**
 * Returns the epoch-second start of the bucket containing `epochSeconds`.
 */
export function bucketStart(epochSeconds: number, bucket: Bucket): number {
  const width = BUCKET_SECONDS[bucket];
  return Math.floor(epochSeconds / width) * width;
}
