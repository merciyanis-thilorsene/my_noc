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

interface PushResult {
  dev_eui: string;
  ok: boolean;
  status?: number;
  message?: string;
}

/** Validates a 0..255 byte field. */
function byte(value: number | undefined, fallback: number): number | null {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < 0 || v > 255) return null;
  return v;
}

/**
 * Builds the Kuando base64 payload from a request body, or null if any field is invalid.
 * Kuando byte order is [red, blue, green, ontime, offtime].
 */
function encodeBusylight(body: BusylightBody): string | null {
  const red = byte(body.red, 0);
  const green = byte(body.green, 0);
  const blue = byte(body.blue, 0);
  const ontime = byte(body.ontime, 255);
  const offtime = byte(body.offtime, 0);
  if (red === null || green === null || blue === null || ontime === null || offtime === null) {
    return null;
  }
  return Buffer.from([red, blue, green, ontime, offtime]).toString('base64');
}

/**
 * Replaces a device's downlink queue on the TTN Application Server. Never throws.
 */
async function pushToTtn(
  config: Configuration,
  logger: Logger,
  devEui: string,
  applicationId: string,
  deviceId: string,
  frmPayload: string,
): Promise<PushResult> {
  const url = `${config.ttnBaseUrl ?? ''}/api/v3/as/applications/${applicationId}`
    + `/devices/${deviceId}/down/replace`;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, TTN_TIMEOUT_MS);
  let result: PushResult;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ttnDownlinkApiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        downlinks: [{ frm_payload: frmPayload, f_port: BUSYLIGHT_F_PORT, priority: 'NORMAL' }],
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      result = { dev_eui: devEui, ok: true };
    } else {
      const snippet = (await res.text()).slice(0, 300);
      logger.warn({ devEui, status: res.status, snippet }, 'TTN downlink rejected.');
      result = {
        dev_eui: devEui, ok: false, status: res.status, message: snippet,
      };
    }
  } catch (error) {
    logger.error({ devEui, err: error }, 'TTN downlink request failed.');
    result = { dev_eui: devEui, ok: false, message: String(error) };
  } finally {
    clearTimeout(timer);
  }
  return result;
}

interface DeviceIds { application_id: string; device_id: string }

/** Looks up a device's TTN application/device id. */
function lookupDevice(db: Db, devEui: string): DeviceIds | undefined {
  return db.prepare(
    'SELECT application_id, device_id FROM devices WHERE dev_eui = ?',
  ).get(devEui) as DeviceIds | undefined;
}

const NOT_CONFIGURED = {
  error: 'DOWNLINK_NOT_CONFIGURED',
  message: 'Set TTN_BASE_URL and TTN_DOWNLINK_API_KEY to enable downlinks.',
};

/**
 * POST /api/devices/:dev_eui/downlink — send a Busylight downlink to one device.
 */
async function sendOne(
  db: Db,
  config: Configuration,
  logger: Logger,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (config.ttnBaseUrl === null || config.ttnDownlinkApiKey === null) {
    return reply.status(501).send(NOT_CONFIGURED);
  }
  const devEui = normalizeEui((request.params as { dev_eui?: string }).dev_eui);
  const frmPayload = encodeBusylight(request.body as BusylightBody);
  if (frmPayload === null) {
    return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Fields must be integers 0..255.' });
  }
  const device = devEui === null ? undefined : lookupDevice(db, devEui);
  if (device === undefined || devEui === null) {
    return reply.status(404).send({ error: 'DEVICE_NOT_FOUND' });
  }
  const result = await pushToTtn(
    config,
    logger,
    devEui,
    device.application_id,
    device.device_id,
    frmPayload,
  );
  return reply.status(result.ok ? 200 : 502).send(result);
}

/**
 * POST /api/downlink — send the same Busylight downlink to many devices.
 * Body: `{ dev_euis: string[], red, green, blue, ontime, offtime }`.
 */
async function sendMany(
  db: Db,
  config: Configuration,
  logger: Logger,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (config.ttnBaseUrl === null || config.ttnDownlinkApiKey === null) {
    return reply.status(501).send(NOT_CONFIGURED);
  }
  const body = request.body as BusylightBody & { dev_euis?: unknown };
  const frmPayload = encodeBusylight(body);
  if (frmPayload === null) {
    return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Fields must be integers 0..255.' });
  }
  const rawEuis = Array.isArray(body.dev_euis) ? body.dev_euis : [];
  const devEuis = rawEuis
    .map((e) => normalizeEui(typeof e === 'string' ? e : undefined))
    .filter((e): e is string => e !== null);
  if (devEuis.length === 0) {
    return reply.status(400).send({ error: 'NO_DEVICES', message: 'Provide dev_euis (non-empty array).' });
  }

  const results = await Promise.all(devEuis.map(async (devEui): Promise<PushResult> => {
    const device = lookupDevice(db, devEui);
    if (device === undefined) {
      return { dev_eui: devEui, ok: false, message: 'device not found' };
    }
    return pushToTtn(config, logger, devEui, device.application_id, device.device_id, frmPayload);
  }));

  const sent = results.filter((r) => r.ok).length;
  return reply.send({ sent, failed: results.length - sent, results });
}

/**
 * Registers downlink routes (single-device and multi-device).
 */
export default function registerDownlinkRoutes(
  instance: FastifyInstance,
  db: Db,
  config: Configuration,
  logger: Logger,
): void {
  instance.post(
    '/api/devices/:dev_eui/downlink',
    (request, reply) => sendOne(db, config, logger, request, reply),
  );
  instance.post('/api/downlink', (request, reply) => sendMany(db, config, logger, request, reply));
}
