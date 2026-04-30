import { pool } from '../../db.js';
import { logger } from '../../logger.js';
import { enqueueKeepalive, getColorState } from './commands.js';
import { COLORS } from './colors.js';

// Plenom Busylight v3.1 sends a keep-alive uplink on FPort 15 roughly every
// 60 minutes; the keep-alive carries downlinks_rx. If that counter stays
// frozen across N consecutive keep-alives, the device hasn't received any
// downlinks recently — its session may be drifting and re-keying soon. Push
// a keepalive downlink to keep the session warm before that happens.
const STUCK_LOOKBACK_HOURS = 6;
const STUCK_MIN_SAMPLES = 3;

type DevSamples = { device_eui: string; counters: number[] };

async function recentDownlinksRxByDevice(): Promise<DevSamples[]> {
  const { rows } = await pool.query<{
    device_eui: string;
    downlinks_rx: number | null;
    rn: string;
  }>(
    `SELECT device_eui, downlinks_rx, rn FROM (
       SELECT device_eui,
              (decoded_payload->>'downlinks_rx')::int AS downlinks_rx,
              row_number() OVER (PARTITION BY device_eui ORDER BY timestamp DESC) AS rn
         FROM leds_uplinks
        WHERE timestamp > now() - ($1 || ' hours')::interval
          AND decoded_payload->>'decoder' = 'busylight_v3.1'
     ) s
     WHERE rn <= $2
     ORDER BY device_eui, rn ASC`,
    [String(STUCK_LOOKBACK_HOURS), STUCK_MIN_SAMPLES],
  );

  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    if (r.downlinks_rx == null) continue;
    const arr = grouped.get(r.device_eui) ?? [];
    arr.push(r.downlinks_rx);
    grouped.set(r.device_eui, arr);
  }
  return [...grouped].map(([device_eui, counters]) => ({ device_eui, counters }));
}

function isStuck(counters: number[]): boolean {
  if (counters.length < STUCK_MIN_SAMPLES) return false;
  return counters.every((v) => v === counters[0]);
}

async function alreadyHasPendingDownlink(devEui: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM device_commands
        WHERE device_eui = $1
          AND acked_at IS NULL
          AND failed_at IS NULL
     ) AS exists`,
    [devEui],
  );
  return rows[0]?.exists ?? false;
}

export async function runWatchdogTick(): Promise<void> {
  const samples = await recentDownlinksRxByDevice();
  for (const { device_eui, counters } of samples) {
    if (!isStuck(counters)) continue;
    if (await alreadyHasPendingDownlink(device_eui)) continue;

    const state = await getColorState(device_eui);
    // Re-send the desired colour if we have one, otherwise nudge with `off`.
    // The point is to give the device a downlink to receive — what it shows
    // matters less than the session staying warm.
    const payloadHex = state?.desired_color ?? COLORS.off;
    await enqueueKeepalive(device_eui, payloadHex);
    logger.warn(
      { device_eui, counters, payload_hex: payloadHex },
      'leds: watchdog enqueued keepalive (downlinks_rx frozen)',
    );
  }
}
