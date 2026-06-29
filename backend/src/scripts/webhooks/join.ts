/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { insertJoin, upsertDevice } from 'scripts/db/queries';
import { extractIdentity, type TtsWebhookPayload } from 'scripts/webhooks/tts';

/**
 * Normalizes a `join_accept` webhook and persists the join plus the device registry entry.
 * Returns `false` when the payload lacks required identifiers.
 */
export default function handleJoin(
  db: Db,
  payload: TtsWebhookPayload,
  receivedAt: string,
): boolean {
  const identity = extractIdentity(payload);
  if (identity === null) {
    return false;
  }
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
  insertJoin(db, {
    timestamp,
    devEui: identity.devEui,
    deviceId: identity.deviceId,
    applicationId: identity.applicationId,
    joinEui: identity.joinEui,
    devAddr: identity.devAddr,
    receivedAt,
  });
  return true;
}
