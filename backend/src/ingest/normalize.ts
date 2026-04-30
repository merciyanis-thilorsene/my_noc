// TTS v3 webhook payload → uplink-v1 canonical schema.
// Keeping the field plucking forgiving: TTS occasionally omits fields on
// re-transmits, and the downstream ML service shouldn't have to deal with
// TTS quirks.

export type UplinkV1 = {
  schema_version: 1;
  received_at: string;
  device_eui: string;
  dev_addr: string | null;
  app_id: string | null;
  device_id: string | null;
  f_cnt_up: number;
  f_port: number | null;
  sf: number;
  data_rate: string;
  frequency: number;
  consumed_airtime_s: number | null;
  decoded_payload: unknown;
  best_rssi: number | null;
  best_snr: number | null;
  gateway_count: number;
  raw_payload_b64: string | null;
  correlation_id: string | null;
  gateways: Array<{
    gateway_eui: string;
    gateway_id: string | null;
    rssi: number;
    snr: number;
    channel_index: number | null;
    channel_rssi: number | null;
  }>;
};

export const NON_UPLINK_EVENTS = [
  'join_accept',
  'downlink_ack',
  'downlink_nack',
  'downlink_failed',
  'downlink_queued',
  'downlink_sent',
  'location_solved',
] as const;
export type NonUplinkEvent = (typeof NON_UPLINK_EVENTS)[number];
export type TtsEventType = 'uplink_message' | NonUplinkEvent;

export function detectEventType(body: unknown): TtsEventType | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.uplink_message) return 'uplink_message';
  for (const e of NON_UPLINK_EVENTS) if (b[e]) return e;
  return null;
}

export function normalizeEui(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const hex = s.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length > 0 ? hex : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseAirtime(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return null;
  const m = /^([\d.]+)\s*s?$/.exec(raw.trim());
  if (!m || !m[1]) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseSf(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object') return null;
  const s = settings as Record<string, unknown>;
  const dataRate = s.data_rate as Record<string, unknown> | undefined;
  const lora = dataRate?.lora as Record<string, unknown> | undefined;
  if (lora && typeof lora.spreading_factor === 'number') return lora.spreading_factor;
  // TTN EU868 convention: data_rate_index 0..5 ↔ SF12..SF7
  if (typeof s.data_rate_index === 'number') return 12 - s.data_rate_index;
  return null;
}

function dataRateString(settings: unknown): string {
  const sf = parseSf(settings);
  if (!settings || typeof settings !== 'object') return '';
  const s = settings as Record<string, unknown>;
  const lora = (s.data_rate as Record<string, unknown> | undefined)?.lora as
    | Record<string, unknown>
    | undefined;
  const bw = lora?.bandwidth;
  if (sf != null && typeof bw === 'number') return `SF${sf}BW${Math.round(bw / 1000)}`;
  if (sf != null) return `SF${sf}`;
  return '';
}

export function normalizeTtsUplink(body: unknown): UplinkV1 | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const u = b.uplink_message as Record<string, unknown> | undefined;
  const ids = b.end_device_ids as Record<string, unknown> | undefined;
  if (!u || !ids) return null;

  const deviceEui = normalizeEui(ids.dev_eui);
  if (!deviceEui) return null;

  const rxRaw = Array.isArray(u.rx_metadata) ? (u.rx_metadata as unknown[]) : [];
  const gateways = rxRaw
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const g = r as Record<string, unknown>;
      const gwIds = g.gateway_ids as Record<string, unknown> | undefined;
      const eui = normalizeEui(gwIds?.eui);
      if (!eui) return null;
      return {
        gateway_eui: eui,
        gateway_id: typeof gwIds?.gateway_id === 'string' ? gwIds.gateway_id : null,
        rssi: asNumber(g.rssi) ?? 0,
        snr: asNumber(g.snr) ?? 0,
        channel_index: typeof g.channel_index === 'number' ? g.channel_index : null,
        channel_rssi: asNumber(g.channel_rssi),
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const bestRssi = gateways.length ? Math.max(...gateways.map((g) => g.rssi)) : null;
  const bestSnr = gateways.length ? Math.max(...gateways.map((g) => g.snr)) : null;

  const sf = parseSf(u.settings) ?? 0;
  const freq = asNumber((u.settings as Record<string, unknown> | undefined)?.frequency) ?? 0;

  const corrIds = Array.isArray(b.correlation_ids)
    ? (b.correlation_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const appIds = ids.application_ids as Record<string, unknown> | undefined;

  return {
    schema_version: 1,
    received_at:
      (typeof b.received_at === 'string' && b.received_at) ||
      (typeof u.received_at === 'string' && u.received_at) ||
      new Date().toISOString(),
    device_eui: deviceEui,
    dev_addr: normalizeEui(ids.dev_addr),
    app_id: typeof appIds?.application_id === 'string' ? appIds.application_id : null,
    device_id: typeof ids.device_id === 'string' ? ids.device_id : null,
    f_cnt_up: Number(u.f_cnt ?? 0) || 0,
    f_port: typeof u.f_port === 'number' ? u.f_port : null,
    sf,
    data_rate: dataRateString(u.settings),
    frequency: freq,
    consumed_airtime_s: parseAirtime(u.consumed_airtime),
    decoded_payload: u.decoded_payload ?? null,
    best_rssi: bestRssi,
    best_snr: bestSnr,
    gateway_count: gateways.length,
    raw_payload_b64: typeof u.frm_payload === 'string' ? u.frm_payload : null,
    correlation_id: corrIds[0] ?? null,
    gateways,
  };
}
