/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { type Configuration } from 'scripts/conf/config';
import { type Logger } from 'scripts/lib/logger';
import { normalizeEui } from 'scripts/webhooks/tts';

/** Kuando Busylight downlink port. */
const BUSYLIGHT_F_PORT = 15;
const TTN_TIMEOUT_MS = 10_000;

/**
 * A Kuando Busylight downlink request. Colours/timings are 0..255.
 * `ontime`/`offtime` are the light's on/off durations (solid = ontime 255, offtime 0).
 */
interface BusylightBody {
  red?: number;
  green?: number;
  blue?: number;
  ontime?: number;
  offtime?: number;
}

/** Validates a 0..255 byte field, returning null when invalid. */
function byte(value: number | undefined, fallback: number): number | null {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 0 || v > 255) return null;
  return v;
}

/**
 * POST /api/devices/:dev_eui/downlink — send a Kuando Busylight downlink via TTN.
 * Encodes the 5-byte payload `[red, blue, green, ontime, offtime]` (Plenom/Kuando format,
 * fPort 15), then replaces the device's downlink queue on the Application Server.
 */
async function sendBusylightDownlink(
  db: Db,
  config: Configuration,
  logger: Logger,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (config.ttnBaseUrl === null || config.ttnDownlinkApiKey === null) {
    return reply.status(501).send({
      error: 'DOWNLINK_NOT_CONFIGURED',
      message: 'Set TTN_BASE_URL and TTN_DOWNLINK_API_KEY to enable downlinks.',
    });
  }

  const devEui = normalizeEui((request.params as { dev_eui?: string }).dev_eui);
  const device = devEui === null ? undefined : db.prepare(
    'SELECT application_id, device_id FROM devices WHERE dev_eui = ?',
  ).get(devEui) as { application_id: string; device_id: string } | undefined;
  if (device === undefined) {
    return reply.status(404).send({ error: 'DEVICE_NOT_FOUND' });
  }

  const body = request.body as BusylightBody;
  const red = byte(body.red, 0);
  const green = byte(body.green, 0);
  const blue = byte(body.blue, 0);
  const ontime = byte(body.ontime, 255);
  const offtime = byte(body.offtime, 0);
  if (red === null || green === null || blue === null || ontime === null || offtime === null) {
    return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Fields must be integers 0..255.' });
  }

  // Kuando byte order is [red, blue, green, ontime, offtime].
  const frmPayload = Buffer.from([red, blue, green, ontime, offtime]).toString('base64');
  const url = `${config.ttnBaseUrl}/api/v3/as/applications/${device.application_id}`
    + `/devices/${device.device_id}/down/replace`;

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, TTN_TIMEOUT_MS);
  let outcome: { code: number; body: object };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ttnDownlinkApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        downlinks: [{ frm_payload: frmPayload, f_port: BUSYLIGHT_F_PORT, priority: 'NORMAL' }],
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      logger.info({ devEui, frmPayload }, 'Busylight downlink queued.');
      outcome = {
        code: 200,
        body: {
          ok: true,
          f_port: BUSYLIGHT_F_PORT,
          frm_payload: frmPayload,
          bytes: [red, blue, green, ontime, offtime],
        },
      };
    } else {
      const snippet = (await res.text()).slice(0, 300);
      logger.warn({ devEui, status: res.status, snippet }, 'TTN downlink rejected.');
      outcome = { code: 502, body: { error: 'TTN_ERROR', status: res.status, message: snippet } };
    }
  } catch (error) {
    logger.error({ devEui, err: error }, 'TTN downlink request failed.');
    outcome = { code: 502, body: { error: 'TTN_UNREACHABLE', message: String(error) } };
  } finally {
    clearTimeout(timer);
  }
  return reply.status(outcome.code).send(outcome.body);
}

/**
 * Registers downlink routes.
 */
export default function registerDownlinkRoutes(
  instance: FastifyInstance,
  db: Db,
  config: Configuration,
  logger: Logger,
): void {
  instance.post(
    '/api/devices/:dev_eui/downlink',
    (request, reply) => sendBusylightDownlink(db, config, logger, request, reply),
  );
}
