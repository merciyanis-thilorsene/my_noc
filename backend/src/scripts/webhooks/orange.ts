/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { insertUplink, upsertDevice, type UplinkRow } from 'scripts/db/queries';
import { boolToInt, normalizeEui } from 'scripts/webhooks/tts';

/**
 * The LoRa network block Orange Live Objects nests under `metadata.network.lora`.
 */
interface OrangeLora {
  devEUI?: string;
  port?: number;
  fcnt?: number;
  rssi?: number;
  snr?: number;
  sf?: number;
  frequency?: number;
  gatewayCnt?: number;
  messageType?: string;
}

/**
 * The subset of an Orange Live Objects message the monitor consumes.
 */
interface OrangeUplink {
  type?: string;
  streamId?: string;
  timestamp?: string;
  value?: { payload?: string };
  metadata?: {
    group?: { path?: string };
    network?: { lora?: OrangeLora };
  };
}

/**
 * Maps Orange's `messageType` to the confirmed flag, or `undefined` for non-data-up types.
 */
function confirmedFromType(messageType: string | undefined): boolean | undefined {
  if (messageType === 'CONFIRMED_DATA_UP') {
    return true;
  }
  if (messageType === 'UNCONFIRMED_DATA_UP') {
    return false;
  }
  return undefined;
}

/**
 * Ingests an Orange Live Objects LoRa webhook.
 *
 * Returns `null` when the payload isn't an Orange envelope (so the TTS path handles it),
 * `true` when accepted (a mapped data uplink, or a non-data Orange event we intentionally
 * skip so Orange doesn't retry), and `false` when it's Orange-shaped but missing the
 * identifiers we need.
 *
 * Orange exposes device-level RF only (aggregate rssi/snr + a gateway count, no per-gateway
 * EUIs), so no `uplink_gateways` rows are written — these uplinks drive device metrics but
 * not the gateway map / per-gateway views.
 *
 * @param db Database connection.
 *
 * @param payload Raw webhook body.
 *
 * @param receivedAt Server receive time (ISO).
 *
 * @returns `true`/`false` when handled as Orange, or `null` when not an Orange payload.
 */
export default function tryOrangeUplink(
  db: Db,
  payload: unknown,
  receivedAt: string,
): boolean | null {
  const body = payload as OrangeUplink;
  const lora = body.metadata?.network?.lora;
  const looksOrange = lora !== undefined
    || (typeof body.streamId === 'string' && body.streamId.startsWith('urn:lo'));
  if (!looksOrange) {
    return null;
  }
  // Orange also emits lifecycle/command events; only data uplinks become an uplink row.
  if (body.type !== undefined && body.type !== 'dataMessage') {
    return true;
  }

  const devEui = normalizeEui(lora?.devEUI ?? body.streamId?.split(':').pop());
  const fCnt = lora?.fcnt;
  if (devEui === null || fCnt === undefined) {
    return false;
  }

  const timestamp = body.timestamp ?? receivedAt;
  const applicationId = body.metadata?.group?.path ?? 'orange-live-objects';
  const frequency = lora?.frequency;
  const frequencyHz = frequency !== undefined ? Math.round(frequency * 1_000_000) : null;

  const uplink: UplinkRow = {
    timestamp,
    devEui,
    // Orange has no separate device id; the DevEUI is the stable key.
    deviceId: devEui,
    applicationId,
    fCnt,
    fPort: lora?.port ?? null,
    frmPayload: body.value?.payload ?? null,
    decodedPayload: null,
    dataRateIndex: null,
    sf: lora?.sf ?? null,
    bandwidth: null,
    codingRate: null,
    frequency: frequencyHz,
    consumedAirtimeS: null,
    confirmed: boolToInt(confirmedFromType(lora?.messageType)),
    adr: null,
    classB: null,
    nBTrans: null,
    bestRssi: lora?.rssi ?? null,
    bestSnr: lora?.snr ?? null,
    gatewayCount: lora?.gatewayCnt ?? 0,
    receivedAt,
    correlationIds: null,
  };

  upsertDevice(db, {
    devEui,
    deviceId: devEui,
    applicationId,
    joinEui: null,
    name: null,
    description: null,
    deviceClass: null,
    lorawanVersion: null,
    seenAt: timestamp,
  });
  insertUplink(db, uplink, []);
  return true;
}
