import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  detectEventType,
  normalizeTtsUplink,
  normalizeEui,
} from '../ingest/normalize.js';
import { persistUplink, persistDeviceEvent } from '../ingest/persist.js';
import { putDeviceRegistry } from '../cache/registry.js';
import { broadcast } from '../ws/live.js';
import { decodeForApp, onAppUplinkPersisted } from '../apps/index.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health',     async () => ({ ok: true }));
  app.get('/tts/health', async () => ({ ok: true }));

  app.post('/tts', async (req, reply) => {
    if (config.tts.webhookSecret) {
      const provided =
        (req.headers['x-tts-secret']      as string | undefined) ??
        (req.headers['x-webhook-secret']  as string | undefined) ??
        '';
      if (provided !== config.tts.webhookSecret) {
        return reply.code(401).send({ error: 'invalid webhook secret' });
      }
    }

    const body = req.body as Record<string, unknown>;
    const eventType = detectEventType(body);
    if (!eventType) {
      return reply.code(202).send({ accepted: true, note: 'unknown event type, ignored' });
    }

    if (eventType === 'uplink_message') {
      const uplink = normalizeTtsUplink(body);
      if (!uplink) {
        return reply.code(202).send({ accepted: true, note: 'failed normalization' });
      }
      // App-specific decoder takes precedence when it can interpret the frame.
      const appDecoded = decodeForApp(uplink.app_id, uplink.raw_payload_b64, uplink.f_port);
      if (appDecoded !== null) uplink.decoded_payload = appDecoded;
      try {
        const id = await persistUplink(uplink);
        // Warm the device registry so the frontend can list devices even
        // before the TTS poller has run.
        await putDeviceRegistry(uplink.device_eui, {
          device_id: uplink.device_id,
          app_id: uplink.app_id,
          last_seen_via: 'webhook',
        });
        // Per-app reaction (e.g. leds ACK detection from downlinks_rx).
        await onAppUplinkPersisted(uplink.app_id, uplink.device_eui, uplink.decoded_payload);
        broadcast('device_uplink', {
          uplink_id: id,
          device_eui: uplink.device_eui,
          app_id: uplink.app_id,
          device_id: uplink.device_id,
          timestamp: uplink.received_at,
          sf: uplink.sf,
          best_rssi: uplink.best_rssi,
          best_snr: uplink.best_snr,
          gateway_count: uplink.gateway_count,
        });
      } catch (err) {
        app.log.error({ err }, 'uplink persist failed');
        return reply.code(500).send({ error: 'persist failed' });
      }
      return reply.code(202).send({ accepted: true, uplink: true });
    }

    // Non-uplink event → device_events
    try {
      const ids = body.end_device_ids as Record<string, unknown> | undefined;
      const devEui = normalizeEui(ids?.dev_eui);
      const ts =
        (typeof body.received_at === 'string' && body.received_at) ||
        new Date().toISOString();
      if (devEui) await persistDeviceEvent(ts, devEui, eventType, body);
    } catch (err) {
      app.log.warn({ err }, 'device event persist failed');
    }
    return reply.code(202).send({ accepted: true, event: eventType });
  });
}
