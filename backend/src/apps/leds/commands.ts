import { pool } from '../../db.js';
import { logger } from '../../logger.js';
import { BUSYLIGHT_FPORT } from './constants.js';
import { hexToBase64 } from './colors.js';

export type CommandType = 'color' | 'adr_off' | 'keepalive';

export type DeviceCommand = {
  id: string;
  device_eui: string;
  command_type: CommandType;
  payload_b64: string;
  f_port: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  created_at: string;
  acked_at: string | null;
  failed_at: string | null;
  downlinks_rx_at_send: number | null;
  correlation_ids: string[] | null;
  last_error: string | null;
  details: Record<string, unknown> | null;
};

export type ColorState = {
  device_eui: string;
  desired_color: string;
  last_acked_color: string | null;
  updated_at: string;
};

// ---- Color state ----

export async function getColorState(devEui: string): Promise<ColorState | null> {
  const { rows } = await pool.query<ColorState>(
    'SELECT * FROM device_color_state WHERE device_eui = $1',
    [devEui],
  );
  return rows[0] ?? null;
}

// Set the desired colour and ensure exactly one pending color command exists
// for the device with this payload. If a pending one is already there for a
// different colour, update it in place (resets attempts so retries target
// the new desired colour). Returns the (now pending) command.
export async function setDesiredColor(
  devEui: string,
  colorHex: string,
): Promise<DeviceCommand> {
  const payload_b64 = hexToBase64(colorHex);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO device_color_state (device_eui, desired_color, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (device_eui)
       DO UPDATE SET desired_color = EXCLUDED.desired_color, updated_at = now()`,
      [devEui, colorHex],
    );

    // Update existing pending color command in place if one exists, else
    // insert a new one. The unique partial index guarantees at most one
    // pending color command per device.
    const { rows: updated } = await client.query<DeviceCommand>(
      `UPDATE device_commands
          SET payload_b64 = $2,
              attempts = 0,
              next_attempt_at = now(),
              downlinks_rx_at_send = NULL,
              correlation_ids = NULL,
              last_error = NULL,
              details = jsonb_build_object('color_hex', $3::text)
        WHERE device_eui = $1
          AND command_type = 'color'
          AND acked_at IS NULL
          AND failed_at IS NULL
        RETURNING *`,
      [devEui, payload_b64, colorHex],
    );
    let cmd = updated[0];
    if (!cmd) {
      const { rows: inserted } = await client.query<DeviceCommand>(
        `INSERT INTO device_commands
           (device_eui, command_type, payload_b64, f_port, details)
         VALUES ($1, 'color', $2, $3, jsonb_build_object('color_hex', $4::text))
         RETURNING *`,
        [devEui, payload_b64, BUSYLIGHT_FPORT, colorHex],
      );
      cmd = inserted[0]!;
    }
    await client.query('COMMIT');
    return cmd;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- Command queue ----

// 0x02 0x00 — Plenom Busylight ADR-disable command on FPort 15.
const ADR_DISABLE_HEX = '0200';

// Enqueue an ADR-disable downlink. Same UPDATE-or-INSERT idempotency pattern
// as setDesiredColor — there's no DB-level unique index on adr_off (alert
// engine ticks single-threaded so the race is unlikely), but the in-code
// dedup prevents a second pending row stacking up if the rule fires twice.
export async function enqueueAdrOff(devEui: string): Promise<DeviceCommand> {
  const payload_b64 = hexToBase64(ADR_DISABLE_HEX);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: updated } = await client.query<DeviceCommand>(
      `UPDATE device_commands
          SET attempts = 0,
              next_attempt_at = now(),
              downlinks_rx_at_send = NULL,
              correlation_ids = NULL,
              last_error = NULL
        WHERE device_eui = $1
          AND command_type = 'adr_off'
          AND acked_at IS NULL
          AND failed_at IS NULL
        RETURNING *`,
      [devEui],
    );
    let cmd = updated[0];
    if (!cmd) {
      const { rows: inserted } = await client.query<DeviceCommand>(
        `INSERT INTO device_commands
           (device_eui, command_type, payload_b64, f_port,
            details)
         VALUES ($1, 'adr_off', $2, $3,
                 jsonb_build_object('payload_hex', $4::text))
         RETURNING *`,
        [devEui, payload_b64, BUSYLIGHT_FPORT, ADR_DISABLE_HEX],
      );
      cmd = inserted[0]!;
    }
    await client.query('COMMIT');
    return cmd;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function enqueueKeepalive(
  devEui: string,
  payloadHex: string,
): Promise<DeviceCommand> {
  const { rows } = await pool.query<DeviceCommand>(
    `INSERT INTO device_commands (device_eui, command_type, payload_b64, f_port, details)
     VALUES ($1, 'keepalive', $2, $3, jsonb_build_object('payload_hex', $4::text))
     RETURNING *`,
    [devEui, hexToBase64(payloadHex), BUSYLIGHT_FPORT, payloadHex],
  );
  return rows[0]!;
}

export async function listPendingDue(limit = 50): Promise<DeviceCommand[]> {
  const { rows } = await pool.query<DeviceCommand>(
    `SELECT * FROM device_commands
      WHERE acked_at IS NULL
        AND failed_at IS NULL
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

// ---- Send accounting ----

export async function recordSendAttempt(
  id: string,
  downlinksRxAtSend: number | null,
  backoffSec: number,
): Promise<void> {
  await pool.query(
    `UPDATE device_commands
        SET attempts = attempts + 1,
            downlinks_rx_at_send = COALESCE($2, downlinks_rx_at_send),
            next_attempt_at = now() + ($3 || ' seconds')::interval,
            last_error = NULL
      WHERE id = $1`,
    [id, downlinksRxAtSend, String(backoffSec)],
  );
}

export async function recordSendError(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE device_commands
        SET attempts = attempts + 1,
            last_error = $2,
            next_attempt_at = now() + INTERVAL '30 seconds'
      WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function markFailedIfMaxedOut(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE device_commands
        SET failed_at = now()
      WHERE acked_at IS NULL
        AND failed_at IS NULL
        AND attempts >= max_attempts`,
  );
  return rowCount ?? 0;
}

// Mark the most-recent pending command for a device as ACKed when the device
// reports a downlinks_rx that's different from the value snapshot we took at
// send time. Busylight reports downlinks_rx as a uint8, so any change is
// taken as ACK (1/256 false-ack risk on exact wrap — acceptable for v1).
//
// On color ACK, also write last_acked_color into device_color_state.
export async function markAckedFromUplink(
  devEui: string,
  downlinksRxNow: number,
): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    command_type: CommandType;
    details: Record<string, unknown> | null;
  }>(
    `UPDATE device_commands
        SET acked_at = now()
      WHERE id = (
        SELECT id FROM device_commands
         WHERE device_eui = $1
           AND acked_at IS NULL
           AND failed_at IS NULL
           AND downlinks_rx_at_send IS NOT NULL
           AND downlinks_rx_at_send <> $2
         ORDER BY next_attempt_at DESC
         LIMIT 1
      )
      RETURNING id, command_type, details`,
    [devEui, downlinksRxNow],
  );
  const cmd = rows[0];
  if (!cmd) return;

  if (cmd.command_type === 'color') {
    const colorHex = (cmd.details?.color_hex ?? null) as string | null;
    if (colorHex) {
      await pool.query(
        `UPDATE device_color_state
            SET last_acked_color = $2, updated_at = now()
          WHERE device_eui = $1`,
        [devEui, colorHex],
      );
    }
  }
  logger.info(
    { device_eui: devEui, command_id: cmd.id, type: cmd.command_type },
    'leds: command acked',
  );
}
