/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { insertDownlink, upsertDevice } from 'scripts/db/queries';
import {
  boolToInt,
  extractIdentity,
  type TtsDownlink,
  type TtsWebhookPayload,
} from 'scripts/webhooks/tts';

/**
 * The downlink lifecycle event keys TTS sends, mapped to our stored `event_type`.
 */
const DOWNLINK_EVENTS: { key: keyof TtsWebhookPayload; type: string }[] = [
  { key: 'downlink_queued', type: 'queued' },
  { key: 'downlink_sent', type: 'sent' },
  { key: 'downlink_ack', type: 'ack' },
  { key: 'downlink_nack', type: 'nack' },
  { key: 'downlink_failed', type: 'failed' },
];

/**
 * Extracts the inner downlink object for an event, unwrapping the `downlink_failed` nesting.
 */
function downlinkBody(payload: TtsWebhookPayload, key: keyof TtsWebhookPayload): TtsDownlink {
  const raw = payload[key];
  if (key === 'downlink_failed') {
    return (raw as { downlink?: TtsDownlink } | undefined)?.downlink ?? {};
  }
  return (raw as TtsDownlink | undefined) ?? {};
}

/**
 * Normalizes a `downlink_*` webhook into a single lifecycle-event row and persists it.
 * Returns `false` when the payload lacks identifiers or carries no recognized downlink event.
 */
export default function handleDownlink(
  db: Db,
  payload: TtsWebhookPayload,
  receivedAt: string,
): boolean {
  const identity = extractIdentity(payload);
  if (identity === null) {
    return false;
  }
  const event = DOWNLINK_EVENTS.find(({ key }) => payload[key] !== undefined);
  if (event === undefined) {
    return false;
  }
  const body = downlinkBody(payload, event.key);
  const timestamp = payload.received_at ?? receivedAt;

  upsertDevice(db, {
    devEui: identity.devEui,
    deviceId: identity.deviceId,
    applicationId: identity.applicationId,
    joinEui: identity.joinEui,
    name: null,
    description: null,
    deviceClass: null,
    lorawanVersion: null,
    seenAt: timestamp,
  });
  insertDownlink(db, {
    timestamp,
    devEui: identity.devEui,
    deviceId: identity.deviceId,
    applicationId: identity.applicationId,
    eventType: event.type,
    fPort: body.f_port ?? null,
    confirmed: boolToInt(body.confirmed),
    frmPayload: body.frm_payload ?? null,
    sessionKeyId: body.session_key_id ?? null,
    correlationIds: payload.correlation_ids === undefined
      ? null
      : JSON.stringify(payload.correlation_ids),
    receivedAt,
  });
  return true;
}
