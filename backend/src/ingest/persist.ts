import { pool } from '../db.js';
import type { UplinkV1 } from './normalize.js';

export async function persistUplink(u: UplinkV1): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO uplinks
        (timestamp, device_eui, dev_addr, app_id, device_id, f_cnt_up, f_port,
         sf, data_rate, frequency, consumed_airtime_s, decoded_payload,
         best_rssi, best_snr, gateway_count, raw_payload_b64, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        u.received_at, u.device_eui, u.dev_addr, u.app_id, u.device_id,
        u.f_cnt_up, u.f_port, u.sf, u.data_rate, u.frequency,
        u.consumed_airtime_s, u.decoded_payload, u.best_rssi, u.best_snr,
        u.gateway_count, u.raw_payload_b64, u.correlation_id,
      ],
    );
    const uplinkId = Number(rows[0]!.id);

    for (const g of u.gateways) {
      await client.query(
        `INSERT INTO uplink_gateways
          (timestamp, uplink_id, gateway_eui, gateway_id, rssi, snr,
           channel_index, channel_rssi)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [
          u.received_at, uplinkId, g.gateway_eui, g.gateway_id,
          g.rssi, g.snr, g.channel_index, g.channel_rssi,
        ],
      );
    }
    await client.query('COMMIT');
    return uplinkId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function persistDeviceEvent(
  timestamp: string,
  deviceEui: string,
  eventType: string,
  details: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO device_events (timestamp, device_eui, event_type, details)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [timestamp, deviceEui, eventType, details],
  );
}
