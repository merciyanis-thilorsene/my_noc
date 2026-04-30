import { logger } from '../../logger.js';
import { getDevice } from '../../cache/registry.js';
import { pool } from '../../db.js';
import { ttsPut } from './ttsClient.js';
import { LEDS_APP_ID } from './constants.js';

// SF8 = data rate index 4 on EU868. RX2 frequency 869.525 MHz is the
// standard EU868 RX2 channel. ADR disabled so the device cannot drift back
// to SF12 once we've pinned it. Matches NOC_LoRaWAN_Specs.md §6.2.
const SF8_DATA_RATE_INDEX = 4;
const RX2_FREQUENCY_HZ = '869525000';

export type ActionResult = {
  ok: boolean;
  device_id: string;
  device_eui: string;
  detail?: string;
};

async function resolveDeviceId(devEui: string): Promise<string> {
  const reg = await getDevice(devEui);
  const fromCache = (reg?.device_id ?? null) as string | null;
  if (fromCache) return fromCache;

  // Fall back to last seen uplink. The webhook ingester stamps device_id on
  // every uplink, so even if the TTS poller hasn't run yet we can recover the
  // identifier needed by the NS API.
  const { rows } = await pool.query<{ device_id: string | null }>(
    `SELECT device_id FROM uplinks
      WHERE device_eui = $1 AND device_id IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 1`,
    [devEui],
  );
  const fromDb = rows[0]?.device_id ?? null;
  if (!fromDb) throw new Error(`device_id unknown for ${devEui}`);
  return fromDb;
}

// forceSf8 stays a direct NS-API config change — it's not a downlink, it's a
// per-device MAC settings update, so the retry queue (which is downlink-only)
// doesn't fit. Idempotent on the TTS side: re-PUTting the same field mask is
// a no-op once the device has been pinned.
export async function forceSf8(devEui: string): Promise<ActionResult> {
  const deviceId = await resolveDeviceId(devEui);
  const path = `/api/v3/ns/applications/${LEDS_APP_ID}/devices/${deviceId}`;
  const body = {
    end_device: {
      ids: {
        device_id: deviceId,
        application_ids: { application_id: LEDS_APP_ID },
      },
      mac_settings: {
        desired_rx2_data_rate_index: SF8_DATA_RATE_INDEX,
        desired_rx2_frequency: RX2_FREQUENCY_HZ,
        desired_rx1_delay: 'RX_DELAY_1',
        adr: { disabled: {} },
      },
    },
    field_mask: {
      paths: [
        'mac_settings.desired_rx2_data_rate_index',
        'mac_settings.desired_rx2_frequency',
        'mac_settings.desired_rx1_delay',
        'mac_settings.adr',
      ],
    },
  };
  await ttsPut(path, body);
  logger.info({ device_eui: devEui, device_id: deviceId }, 'leds: force_sf8 sent');
  return { ok: true, device_id: deviceId, device_eui: devEui };
}
