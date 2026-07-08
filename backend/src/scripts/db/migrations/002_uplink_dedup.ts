/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Idempotent uplink ingest. Part B adds the WMC poller as a third writer against the single
 * SQLite connection; a bulk gateway upsert can hold the write lock long enough for a
 * synchronous webhook write to stall past the LNS's timeout and be retried, re-delivering the
 * same uplink. This uniqueness constraint makes those retries no-ops.
 *
 * A genuine retry re-sends the byte-identical webhook, so `(dev_eui, f_cnt, timestamp)` — where
 * `timestamp` is the network `received_at` — matches exactly. Two legitimate uplinks that share
 * a frame counter across a rejoin differ in `timestamp`, so both are kept.
 *
 * Pre-existing duplicates (from retries delivered before this constraint existed) are collapsed
 * first, keeping the earliest-inserted row; `uplink_gateways` rows of removed uplinks cascade
 * via their foreign key.
 */
export default `
DELETE FROM uplinks WHERE id NOT IN (
  SELECT MIN(id) FROM uplinks GROUP BY dev_eui, f_cnt, timestamp
);

CREATE UNIQUE INDEX idx_uplinks_dedup ON uplinks(dev_eui, f_cnt, timestamp);
`;
