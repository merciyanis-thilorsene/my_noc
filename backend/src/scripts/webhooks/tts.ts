/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Loose, partial typings for the parts of the TTS v3 webhook payload we consume.
 *
 * Everything is optional on purpose: TTS payloads vary by event type, region, and stack
 * version, and we would rather normalize defensively than reject on a missing field.
 */

export interface TtsEndDeviceIds {
  device_id?: string;
  application_ids?: { application_id?: string };
  dev_eui?: string;
  join_eui?: string;
  dev_addr?: string;
}

export interface TtsGatewayMetadata {
  gateway_ids?: { gateway_id?: string; eui?: string };
  time?: string;
  rssi?: number;
  channel_rssi?: number;
  snr?: number;
  channel_index?: number;
  location?: { latitude?: number; longitude?: number };
}

export interface TtsDataRate {
  lora?: { bandwidth?: number; spreading_factor?: number; coding_rate?: string };
}

export interface TtsUplinkSettings {
  data_rate?: TtsDataRate;
  data_rate_index?: number;
  coding_rate?: string;
  frequency?: string;
}

export interface TtsUplinkMessage {
  f_port?: number;
  f_cnt?: number;
  frm_payload?: string;
  decoded_payload?: unknown;
  rx_metadata?: TtsGatewayMetadata[];
  settings?: TtsUplinkSettings;
  consumed_airtime?: string;
  confirmed?: boolean;
  version_ids?: { lorawan_version?: string };
}

export interface TtsJoinAccept {
  session_key_id?: string;
  received_at?: string;
}

export interface TtsDownlink {
  f_port?: number;
  confirmed?: boolean;
  frm_payload?: string;
  session_key_id?: string;
}

/**
 * The top-level webhook envelope shared by every event type.
 */
export interface TtsWebhookPayload {
  end_device_ids?: TtsEndDeviceIds;
  correlation_ids?: string[];
  received_at?: string;
  uplink_message?: TtsUplinkMessage;
  join_accept?: TtsJoinAccept;
  downlink_ack?: TtsDownlink;
  downlink_nack?: TtsDownlink;
  downlink_failed?: { downlink?: TtsDownlink };
  downlink_queued?: TtsDownlink;
  downlink_sent?: TtsDownlink;
}

/**
 * Normalizes a DevEUI to uppercase hex with separators stripped. Returns `null` if absent.
 */
export function normalizeEui(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  return raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/**
 * Parses a TTS airtime string such as `"0.046336s"` into seconds. Returns `null` if absent.
 */
export function parseAirtime(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = Number.parseFloat(raw.replace(/s$/, ''));
  return Number.isNaN(value) ? null : value;
}

/**
 * Parses a numeric string (e.g. frequency in Hz) into an integer. Returns `null` if absent.
 */
export function parseIntOrNull(raw: string | number | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * Converts a boolean-ish flag to the 0/1 integer SQLite stores, or `null` when undefined.
 */
export function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  return value ? 1 : 0;
}

/**
 * The shared identity fields every normalized row needs. `null` is returned when the
 * payload lacks the minimum required identifiers (DevEUI, device_id, application_id).
 */
export interface DeviceIdentity {
  devEui: string;
  deviceId: string;
  applicationId: string;
  joinEui: string | null;
  devAddr: string | null;
}

/**
 * Extracts and validates the device identity from a webhook envelope.
 */
export function extractIdentity(payload: TtsWebhookPayload): DeviceIdentity | null {
  const ids = payload.end_device_ids;
  const devEui = normalizeEui(ids?.dev_eui);
  const deviceId = ids?.device_id;
  const applicationId = ids?.application_ids?.application_id;
  if (devEui === null || deviceId === undefined || applicationId === undefined) {
    return null;
  }
  return {
    devEui,
    deviceId,
    applicationId,
    joinEui: normalizeEui(ids?.join_eui),
    devAddr: ids?.dev_addr ?? null,
  };
}
