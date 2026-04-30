import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  putAppRegistry,
  putDeviceRegistry,
  putGatewayRegistry,
} from '../cache/registry.js';
import { normalizeEui } from '../ingest/normalize.js';

const TIMEOUT_MS = 15_000;

async function ttsFetch(path: string): Promise<unknown> {
  const url = `${config.tts.baseUrl}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TTS ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function pollTts(): Promise<void> {
  if (!config.tts.baseUrl || !config.tts.apiKey) return;

  // --- Gateways (workspace-wide, not app-scoped) ---
  try {
    const fieldMask = [
      'name',
      'description',
      'location_public',
      'frequency_plan_id',
      'gateway_server_address',
      'version_ids',
    ].join(',');
    const data = (await ttsFetch(`/api/v3/gateways?field_mask=${fieldMask}`)) as {
      gateways?: unknown[];
    };
    const list = Array.isArray(data.gateways) ? data.gateways : [];
    let kept = 0;
    for (const gw of list) {
      if (!gw || typeof gw !== 'object') continue;
      const g = gw as Record<string, unknown>;
      const ids = g.ids as Record<string, unknown> | undefined;
      const eui = normalizeEui(ids?.eui);
      if (!eui) continue;
      await putGatewayRegistry(eui, {
        gateway_id: typeof ids?.gateway_id === 'string' ? ids.gateway_id : null,
        name: typeof g.name === 'string' ? g.name : null,
        description: typeof g.description === 'string' ? g.description : null,
        frequency_plan_id:
          typeof g.frequency_plan_id === 'string' ? g.frequency_plan_id : null,
        location: g.location_public ?? null,
        tts_source: true,
      });
      kept += 1;
    }
    logger.info({ count: kept }, 'tts: gateways refreshed');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'tts: gateway poll failed');
  }

  // --- Applications + their devices (scoped by TTS_APP_IDS) ---
  for (const appId of config.tts.appIds) {
    try {
      const app = (await ttsFetch(`/api/v3/applications/${appId}`)) as Record<string, unknown>;
      await putAppRegistry(appId, {
        name: typeof app.name === 'string' ? app.name : null,
        description: typeof app.description === 'string' ? app.description : null,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, appId }, 'tts: app fetch failed');
    }

    try {
      const data = (await ttsFetch(
        `/api/v3/applications/${appId}/devices?field_mask=name,description,version_ids,attributes`,
      )) as { end_devices?: unknown[] };
      const list = Array.isArray(data.end_devices) ? data.end_devices : [];
      let kept = 0;
      for (const d of list) {
        if (!d || typeof d !== 'object') continue;
        const dev = d as Record<string, unknown>;
        const ids = dev.ids as Record<string, unknown> | undefined;
        const devEui = normalizeEui(ids?.dev_eui);
        if (!devEui) continue;
        await putDeviceRegistry(devEui, {
          device_id: typeof ids?.device_id === 'string' ? ids.device_id : null,
          app_id: appId,
          name: typeof dev.name === 'string' ? dev.name : null,
          description: typeof dev.description === 'string' ? dev.description : null,
          join_eui: normalizeEui(ids?.join_eui),
          attributes: dev.attributes ?? null,
          version_ids: dev.version_ids ?? null,
          tts_source: true,
        });
        kept += 1;
      }
      logger.info({ appId, count: kept }, 'tts: devices refreshed');
    } catch (err) {
      logger.warn({ err: (err as Error).message, appId }, 'tts: device poll failed');
    }
  }
}
