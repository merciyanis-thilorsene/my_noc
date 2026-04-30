// Per-application dispatchers. Generic ingestion and alert engine call into
// this file; this file fans out to each app/<name>/ module. Adding a new app
// means adding one entry to APP_DECODERS / APP_RULE_EVALUATORS / APP_POST_INGEST.

import { logger } from '../logger.js';
import {
  decodeBusylightUplink,
  evaluateLedsRules,
  LEDS_APP_ID,
  onLedsUplinkPersisted,
} from './leds/index.js';

type AppDecoder = (frmPayloadB64: string | null, fPort: number | null) => unknown | null;
type AppPostIngest = (devEui: string, decoded: unknown) => Promise<void>;

const APP_DECODERS: Record<string, AppDecoder> = {
  [LEDS_APP_ID]: decodeBusylightUplink,
};

const APP_POST_INGEST: Record<string, AppPostIngest> = {
  [LEDS_APP_ID]: onLedsUplinkPersisted,
};

export function decodeForApp(
  appId: string | null,
  frmPayloadB64: string | null,
  fPort: number | null,
): unknown | null {
  if (!appId) return null;
  const decoder = APP_DECODERS[appId];
  if (!decoder) return null;
  try {
    return decoder(frmPayloadB64, fPort);
  } catch (err) {
    logger.warn({ err, app_id: appId }, 'app decoder threw');
    return null;
  }
}

// Called from the webhook after persistUplink. Per-app modules use this to
// react to fresh uplinks (e.g. ACK detection from decoded payload).
export async function onAppUplinkPersisted(
  appId: string | null,
  devEui: string,
  decoded: unknown,
): Promise<void> {
  if (!appId) return;
  const fn = APP_POST_INGEST[appId];
  if (!fn) return;
  try {
    await fn(devEui, decoded);
  } catch (err) {
    logger.warn({ err, app_id: appId, device_eui: devEui }, 'app post-ingest hook threw');
  }
}

const APP_RULE_EVALUATORS: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'leds', fn: evaluateLedsRules },
];

export async function runAppRules(): Promise<void> {
  await Promise.all(
    APP_RULE_EVALUATORS.map(async ({ name, fn }) => {
      try {
        await fn();
      } catch (err) {
        logger.error({ err, app: name }, 'app rules evaluator threw');
      }
    }),
  );
}
