import { pool } from '../../db.js';

// In-process cache of the sf_exclusions table. The list is human-curated and
// changes very rarely, so a 60s TTL is plenty and avoids hammering the DB on
// every alert tick (one query per device otherwise).
const TTL_MS = 60_000;

let cache: { at: number; set: Set<string> } | null = null;

export async function loadSfExclusions(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.set;
  const { rows } = await pool.query<{ device_eui: string }>(
    'SELECT device_eui FROM sf_exclusions',
  );
  const set = new Set(rows.map((r) => r.device_eui));
  cache = { at: now, set };
  return set;
}

export function invalidateSfExclusions(): void {
  cache = null;
}
