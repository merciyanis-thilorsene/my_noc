import { pool } from '../../db.js';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import { ttsPost } from './ttsClient.js';
import { LEDS_APP_ID } from './constants.js';
import {
  type DeviceCommand,
  listPendingDue,
  markFailedIfMaxedOut,
  recordSendAttempt,
  recordSendError,
} from './commands.js';
import { getDevice } from '../../cache/registry.js';

const RETRY_BACKOFF_SEC = 30;

async function resolveDeviceId(devEui: string): Promise<string | null> {
  const reg = await getDevice(devEui);
  const fromCache = (reg?.device_id ?? null) as string | null;
  if (fromCache) return fromCache;
  const { rows } = await pool.query<{ device_id: string | null }>(
    `SELECT device_id FROM uplinks
      WHERE device_eui = $1 AND device_id IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 1`,
    [devEui],
  );
  return rows[0]?.device_id ?? null;
}

// Latest downlinks_rx counter from the device's own busylight keep-alive,
// snapshotted at send time. The next uplink's counter will differ if the
// device received this downlink — that's how ACK detection works.
async function latestDownlinksRx(devEui: string): Promise<number | null> {
  const { rows } = await pool.query<{ downlinks_rx: number | null }>(
    `SELECT (decoded_payload->>'downlinks_rx')::int AS downlinks_rx
       FROM leds_uplinks
      WHERE device_eui = $1
        AND decoded_payload->>'decoder' = 'busylight_v3.1'
      ORDER BY timestamp DESC
      LIMIT 1`,
    [devEui],
  );
  return rows[0]?.downlinks_rx ?? null;
}

async function pushOne(cmd: DeviceCommand): Promise<void> {
  const deviceId = await resolveDeviceId(cmd.device_eui);
  if (!deviceId) {
    await recordSendError(cmd.id, 'device_id unknown');
    return;
  }
  const path = `/api/v3/as/applications/${LEDS_APP_ID}/devices/${deviceId}/down/push`;
  const body = {
    downlinks: [
      {
        frm_payload: cmd.payload_b64,
        f_port: cmd.f_port,
        confirmed: true,
        priority: 'NORMAL',
      },
    ],
  };

  // Snapshot downlinks_rx before the push so the next uplink's counter can
  // be compared to confirm receipt.
  const downlinksRxAtSend = await latestDownlinksRx(cmd.device_eui);

  try {
    await ttsPost(path, body);
    await recordSendAttempt(cmd.id, downlinksRxAtSend, RETRY_BACKOFF_SEC);
    logger.info(
      {
        command_id: cmd.id,
        device_eui: cmd.device_eui,
        type: cmd.command_type,
        attempt: cmd.attempts + 1,
        downlinks_rx_at_send: downlinksRxAtSend,
      },
      'leds: downlink pushed',
    );
  } catch (err) {
    const message = (err as Error).message;
    await recordSendError(cmd.id, message);
    logger.warn(
      {
        command_id: cmd.id,
        device_eui: cmd.device_eui,
        attempt: cmd.attempts + 1,
        err: message,
      },
      'leds: downlink push failed',
    );
  }
}

export async function runRetryTick(): Promise<void> {
  if (!config.tts.baseUrl || !config.tts.apiKey) return;
  const due = await listPendingDue();
  if (due.length === 0) return;
  for (const cmd of due) await pushOne(cmd);
  const failed = await markFailedIfMaxedOut();
  if (failed > 0) {
    logger.warn({ count: failed }, 'leds: commands marked failed (max attempts reached)');
  }
}
