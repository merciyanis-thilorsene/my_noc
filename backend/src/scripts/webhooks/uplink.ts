/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import {
  type Db,
} from 'scripts/db/connection';
import {
  upsertDevice,
  insertUplink,
  type GatewayRow,
  type UplinkRow,
} from 'scripts/db/queries';
import {
  boolToInt,
  extractIdentity,
  normalizeEui,
  parseAirtime,
  parseIntOrNull,
  type TtsGatewayMetadata,
  type TtsWebhookPayload,
} from 'scripts/webhooks/tts';
import tryOrangeUplink from 'scripts/webhooks/orange';

/**
 * Maps a single TTS rx_metadata entry to a gateway row.
 */
function toGatewayRow(meta: TtsGatewayMetadata, fallbackTimestamp: string): GatewayRow {
  return {
    gatewayEui: normalizeEui(meta.gateway_ids?.eui),
    gatewayId: meta.gateway_ids?.gateway_id ?? null,
    rssi: meta.rssi ?? null,
    snr: meta.snr ?? null,
    channelIndex: meta.channel_index ?? null,
    channelRssi: meta.channel_rssi ?? null,
    timestamp: meta.time ?? fallbackTimestamp,
    locationLatitude: meta.location?.latitude ?? null,
    locationLongitude: meta.location?.longitude ?? null,
  };
}

/**
 * Returns the maximum of the defined values, or `null` when none are present.
 */
function maxOrNull(values: (number | null)[]): number | null {
  const defined = values.filter((v): v is number => v !== null);
  return defined.length === 0 ? null : Math.max(...defined);
}

/**
 * Normalizes an uplink webhook and persists the uplink, its gateways, and the device registry
 * entry. Accepts both The Things Stack v3 and Orange Live Objects payloads (the latter handled
 * by {@link tryOrangeUplink}). Returns `false` when the payload lacks required identifiers or
 * is missing the uplink message body.
 */
export default function handleUplink(
  db: Db,
  payload: TtsWebhookPayload,
  receivedAt: string,
): boolean {
  // Orange Live Objects uses a different envelope; delegate when it recognizes the shape.
  const orange = tryOrangeUplink(db, payload, receivedAt);
  if (orange !== null) {
    return orange;
  }
  const identity = extractIdentity(payload);
  const message = payload.uplink_message;
  if (identity === null || message?.f_cnt === undefined) {
    return false;
  }

  const timestamp = payload.received_at ?? receivedAt;
  const lora = message.settings?.data_rate?.lora;
  const gateways = (message.rx_metadata ?? []).map((meta) => toGatewayRow(meta, timestamp));

  const uplink: UplinkRow = {
    timestamp,
    devEui: identity.devEui,
    deviceId: identity.deviceId,
    applicationId: identity.applicationId,
    fCnt: message.f_cnt,
    fPort: message.f_port ?? null,
    frmPayload: message.frm_payload ?? null,
    decodedPayload: message.decoded_payload === undefined
      ? null
      : JSON.stringify(message.decoded_payload),
    dataRateIndex: message.settings?.data_rate_index ?? null,
    sf: lora?.spreading_factor ?? null,
    bandwidth: lora?.bandwidth ?? null,
    codingRate: lora?.coding_rate ?? message.settings?.coding_rate ?? null,
    frequency: parseIntOrNull(message.settings?.frequency),
    consumedAirtimeS: parseAirtime(message.consumed_airtime),
    confirmed: boolToInt(message.confirmed),
    adr: null,
    classB: null,
    nBTrans: null,
    bestRssi: maxOrNull(gateways.map((g) => g.rssi)),
    bestSnr: maxOrNull(gateways.map((g) => g.snr)),
    gatewayCount: gateways.length,
    receivedAt,
    correlationIds: payload.correlation_ids === undefined
      ? null
      : JSON.stringify(payload.correlation_ids),
  };

  upsertDevice(db, {
    devEui: identity.devEui,
    deviceId: identity.deviceId,
    applicationId: identity.applicationId,
    joinEui: identity.joinEui,
    name: null,
    description: null,
    deviceClass: null,
    lorawanVersion: message.version_ids?.lorawan_version ?? null,
    seenAt: timestamp,
  });
  insertUplink(db, uplink, gateways);
  return true;
}
