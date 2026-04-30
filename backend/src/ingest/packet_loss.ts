// Packet-loss math for LoRaWAN uplinks.
//
// Every uplink carries `f_cnt_up`, which the device increments on each send.
// If we see 42, 44, 46 land, then 43 and 45 were lost on the air — that's a
// real loss count at the network server, not an estimate.
//
// Complication: devices reset f_cnt_up on reboot or ABP re-provision, which
// looks like a huge backwards jump. We detect a reset whenever
// `f_cnt_up < previous_f_cnt_up` and segment the counter into contiguous runs.
// `max - min + 1` within each segment gives the expected count for that run;
// summing across segments gives the window total.

import { pool } from '../db.js';

export type LossTotals = { received: number; expected: number; loss_pct: number };

// Rolls up loss across the whole window, per device. Reset-aware.
export async function computeLoss(
  deviceEui: string,
  from: string,
  to: string,
): Promise<LossTotals> {
  const { rows } = await pool.query<{ received: string; expected: string }>(
    `WITH ordered AS (
       SELECT f_cnt_up, timestamp,
              CASE WHEN f_cnt_up < lag(f_cnt_up) OVER (ORDER BY timestamp)
                   THEN 1 ELSE 0 END AS is_reset
         FROM uplinks
        WHERE device_eui = $1
          AND timestamp BETWEEN $2 AND $3
          AND f_cnt_up IS NOT NULL
     ),
     segmented AS (
       SELECT f_cnt_up,
              sum(is_reset) OVER (ORDER BY timestamp) AS segment
         FROM ordered
     ),
     per_segment AS (
       SELECT count(*)                          AS received,
              max(f_cnt_up) - min(f_cnt_up) + 1 AS expected
         FROM segmented
        GROUP BY segment
     )
     SELECT COALESCE(sum(received), 0)::bigint AS received,
            COALESCE(sum(expected), 0)::bigint AS expected
       FROM per_segment`,
    [deviceEui, from, to],
  );
  const received = Number(rows[0]?.received ?? 0);
  const expected = Number(rows[0]?.expected ?? 0);
  const loss_pct = expected > 0 ? Math.max(0, Math.min(100, ((expected - received) / expected) * 100)) : 0;
  return { received, expected, loss_pct };
}

// Hourly-bucketed loss for a device over a window. Reset boundaries are
// respected inside each bucket; if a reset falls mid-hour, both segments in
// that hour contribute to the expected/received totals for that hour.
export async function computeLossPerBucket(
  deviceEui: string,
  from: string,
  to: string,
  bucket: '15 minutes' | '1 hour',
): Promise<Array<{ bucket: string; received: number; expected: number; loss_pct: number }>> {
  const { rows } = await pool.query<{
    bucket: string;
    received: string;
    expected: string;
  }>(
    `WITH slots AS (
       SELECT generate_series(
         time_bucket($4::interval, $2::timestamptz),
         time_bucket($4::interval, $3::timestamptz),
         $4::interval
       ) AS bucket
     ),
     ordered AS (
       SELECT f_cnt_up, timestamp,
              time_bucket($4::interval, timestamp) AS bucket,
              CASE WHEN f_cnt_up < lag(f_cnt_up) OVER (ORDER BY timestamp)
                   THEN 1 ELSE 0 END AS is_reset
         FROM uplinks
        WHERE device_eui = $1
          AND timestamp BETWEEN $2 AND $3
          AND f_cnt_up IS NOT NULL
     ),
     segmented AS (
       SELECT bucket, f_cnt_up,
              sum(is_reset) OVER (ORDER BY timestamp) AS segment
         FROM ordered
     ),
     per_bucket_segment AS (
       SELECT bucket,
              count(*)                          AS received,
              max(f_cnt_up) - min(f_cnt_up) + 1 AS expected
         FROM segmented
        GROUP BY bucket, segment
     ),
     per_bucket AS (
       SELECT bucket, sum(received) AS received, sum(expected) AS expected
         FROM per_bucket_segment
        GROUP BY bucket
     )
     SELECT slots.bucket,
            COALESCE(per_bucket.received, 0)::bigint AS received,
            COALESCE(per_bucket.expected, 0)::bigint AS expected
       FROM slots LEFT JOIN per_bucket USING (bucket)
      ORDER BY slots.bucket ASC`,
    [deviceEui, from, to, bucket],
  );
  return rows.map((r) => {
    const received = Number(r.received);
    const expected = Number(r.expected);
    const loss_pct = expected > 0
      ? Math.max(0, Math.min(100, ((expected - received) / expected) * 100))
      : 0;
    return { bucket: r.bucket, received, expected, loss_pct };
  });
}
