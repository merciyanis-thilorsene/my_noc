import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { getDevice } from '../../cache/registry.js';
import { pool } from '../../db.js';
import { forceSf8 } from './actions.js';
import { TtsApiError, TtsNotConfiguredError } from './ttsClient.js';
import { colorNameForHex, COLOR_NAMES, resolveColorHex } from './colors.js';
import { enqueueAdrOff, getColorState, setDesiredColor } from './commands.js';

type Params = { dev_eui: string };

async function ensureKnownDevice(devEui: string): Promise<boolean> {
  const reg = await getDevice(devEui);
  return reg !== null;
}

function handleActionError(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof TtsNotConfiguredError) {
    return { status: 503, body: { error: 'TTS integration not configured' } };
  }
  if (err instanceof TtsApiError) {
    // Pass through TTS's status when it's a client-side error so operators
    // see "device not found in TTS" or "auth failed" rather than a generic 500.
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return { status, body: { error: err.message } };
  }
  return { status: 500, body: { error: (err as Error).message } };
}

export async function ledsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/lorawan/stats', async () => {
    // Latest known SF and adr_state per leds device.
    const { rows: latest } = await pool.query<{
      device_eui: string;
      sf: number | null;
      adr_state: number | null;
    }>(
      `SELECT DISTINCT ON (device_eui)
              device_eui,
              sf,
              (decoded_payload->>'adr_state')::int AS adr_state
         FROM leds_uplinks
        ORDER BY device_eui, timestamp DESC`,
    );

    let onSf12 = 0;
    let adrEnabled = 0;
    for (const r of latest) {
      if (r.sf === 12) onSf12 += 1;
      if (r.adr_state != null && r.adr_state !== 0) adrEnabled += 1;
    }

    const [{ rows: pending }, { rows: failed24h }, { rows: alertCounts }] = await Promise.all([
      pool.query<{ command_type: string; count: string }>(
        `SELECT command_type, count(*)::bigint AS count
           FROM device_commands
          WHERE acked_at IS NULL AND failed_at IS NULL
          GROUP BY command_type`,
      ),
      pool.query<{ count: string }>(
        `SELECT count(*)::bigint AS count
           FROM device_commands
          WHERE failed_at IS NOT NULL
            AND failed_at > now() - INTERVAL '24 hours'`,
      ),
      pool.query<{ rule_name: string; severity: string; count: string }>(
        `SELECT rule_name, severity, count(*)::bigint AS count
           FROM alerts
          WHERE rule_name LIKE 'leds\\_%' ESCAPE '\\'
            AND cleared_at IS NULL
          GROUP BY rule_name, severity`,
      ),
    ]);

    const pendingByType: Record<string, number> = { color: 0, adr_off: 0, keepalive: 0 };
    for (const p of pending) pendingByType[p.command_type] = Number(p.count);

    return {
      devices: {
        total: latest.length,
        on_sf12: onSf12,
        adr_enabled: adrEnabled,
      },
      commands: {
        pending: pendingByType,
        failed_24h: Number(failed24h[0]?.count ?? 0),
      },
      alerts: alertCounts.map((a) => ({
        rule_name: a.rule_name,
        severity: a.severity,
        count: Number(a.count),
      })),
    };
  });

  app.post<{ Params: Params }>('/lorawan/devices/:dev_eui/force-sf8', async (req, reply) => {
    if (!config.tts.baseUrl || !config.tts.apiKey) {
      return reply.code(503).send({ error: 'TTS integration not configured' });
    }
    const dev_eui = req.params.dev_eui.toUpperCase();
    if (!(await ensureKnownDevice(dev_eui))) {
      return reply.code(404).send({ error: 'device not found in registry' });
    }
    try {
      const result = await forceSf8(dev_eui);
      return reply.code(202).send(result);
    } catch (err) {
      const { status, body } = handleActionError(err);
      return reply.code(status).send(body);
    }
  });

  app.post<{ Params: Params; Body: { color?: string } }>(
    '/lorawan/devices/:dev_eui/color',
    async (req, reply) => {
      const dev_eui = req.params.dev_eui.toUpperCase();
      const requested = (req.body?.color ?? '').trim();
      if (!requested) {
        return reply.code(400).send({
          error: `body.color is required (one of: ${COLOR_NAMES.join(', ')}, or 5-byte hex)`,
        });
      }
      const hex = resolveColorHex(requested);
      if (!hex) {
        return reply.code(400).send({
          error: `unknown color "${requested}" (expected one of: ${COLOR_NAMES.join(', ')}, or 5-byte hex)`,
        });
      }
      if (!(await ensureKnownDevice(dev_eui))) {
        return reply.code(404).send({ error: 'device not found in registry' });
      }
      const cmd = await setDesiredColor(dev_eui, hex);
      return reply.code(202).send({
        ok: true,
        device_eui: dev_eui,
        color: { hex, name: colorNameForHex(hex) },
        command_id: cmd.id,
        next_attempt_at: cmd.next_attempt_at,
      });
    },
  );

  app.get<{ Params: Params }>('/lorawan/devices/:dev_eui/color', async (req, reply) => {
    const dev_eui = req.params.dev_eui.toUpperCase();
    const state = await getColorState(dev_eui);
    const { rows } = await pool.query<{
      id: string;
      command_type: string;
      attempts: number;
      max_attempts: number;
      next_attempt_at: string;
      created_at: string;
      details: Record<string, unknown> | null;
    }>(
      `SELECT id, command_type, attempts, max_attempts, next_attempt_at, created_at, details
         FROM device_commands
        WHERE device_eui = $1
          AND command_type = 'color'
          AND acked_at IS NULL
          AND failed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [dev_eui],
    );
    if (!state && rows.length === 0) {
      return reply.code(404).send({ error: 'no color state for device' });
    }
    return {
      device_eui: dev_eui,
      desired:    state ? { hex: state.desired_color, name: colorNameForHex(state.desired_color) } : null,
      last_acked: state?.last_acked_color
        ? { hex: state.last_acked_color, name: colorNameForHex(state.last_acked_color) }
        : null,
      pending_command: rows[0] ?? null,
    };
  });

  app.post<{ Params: Params }>('/lorawan/devices/:dev_eui/adr-off', async (req, reply) => {
    const dev_eui = req.params.dev_eui.toUpperCase();
    if (!(await ensureKnownDevice(dev_eui))) {
      return reply.code(404).send({ error: 'device not found in registry' });
    }
    const cmd = await enqueueAdrOff(dev_eui);
    return reply.code(202).send({
      ok: true,
      device_eui: dev_eui,
      command_id: cmd.id,
      next_attempt_at: cmd.next_attempt_at,
    });
  });
}
