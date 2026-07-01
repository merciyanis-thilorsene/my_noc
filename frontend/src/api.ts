import { useQuery } from '@tanstack/react-query';

// All API paths are resolved against the app's base (e.g. `/monitor/`) so the tool works
// when hosted under a Traefik path prefix as well as at the domain root.
const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BASE}${path.replace(/^\//, '')}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

/* ── Response types (mirror the backend API) ──────────────────────────────── */

export interface Overview {
  total_devices: number;
  active_devices_24h: number;
  silent_devices_24h: number;
  total_uplinks_24h: number;
  total_downlinks_24h: number;
  downlink_success_rate_24h: number | null;
  avg_packet_loss_pct: number | null;
  avg_rssi: number | null;
  avg_snr: number | null;
  uplinks_per_hour_24h: SeriesPoint[];
}

export interface DeviceListItem {
  dev_eui: string;
  device_id: string;
  application_id: string;
  name: string | null;
  last_seen_at: string;
  uplinks_24h: number;
  expected_uplinks_24h: number | null;
  packet_loss_pct_24h: number | null;
  n_b_trans_avg_24h: number | null;
  avg_rssi_24h: number | null;
  avg_snr_24h: number | null;
  current_sf: number | null;
  battery_pct: number | null;
  downlinks_24h: number;
  downlinks_failed_24h: number;
}

export interface DeviceListResponse {
  total: number;
  limit: number;
  offset: number;
  items: DeviceListItem[];
}

export interface DeviceRecord {
  dev_eui: string;
  device_id: string;
  application_id: string;
  join_eui: string | null;
  name: string | null;
  description: string | null;
  device_class: string | null;
  lorawan_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export type WindowMetrics = Record<string, number | null>;

export interface DeviceDetail {
  device: DeviceRecord;
  current_sf: number | null;
  metrics: Record<string, WindowMetrics>;
}

export type SeriesPoint = Record<string, number | string | null> & { t: string };

export interface SeriesResult {
  metric: string;
  bucket: string;
  from: string;
  to: string;
  series: SeriesPoint[];
}

export interface UplinkRow {
  id: number;
  timestamp: string;
  f_cnt: number;
  f_port: number | null;
  sf: number | null;
  frequency: number | null;
  best_rssi: number | null;
  best_snr: number | null;
  gateway_count: number;
  n_b_trans: number | null;
  consumed_airtime_s: number | null;
  decoded_payload: string | null;
  gateways: Record<string, unknown>[];
}

export interface DownlinkGroup {
  correlation_id: string;
  first_seen: string;
  events: { event_type: string; timestamp: string; confirmed: number | null; f_port: number | null }[];
}

export interface JoinRow {
  id: number;
  timestamp: string;
  dev_addr: string | null;
  join_eui: string | null;
  device_id: string;
  dev_eui: string;
}

/* ── Hooks ────────────────────────────────────────────────────────────────── */

const REFETCH = { refetchInterval: 30_000, staleTime: 15_000 };

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: () => fetchJson<Overview>('/api/overview'), ...REFETCH });
}

export function useDevices(search: string, sort: string) {
  const qs = new URLSearchParams({ sort, limit: '500' });
  if (search) qs.set('search', search);
  return useQuery({
    queryKey: ['devices', search, sort],
    queryFn: () => fetchJson<DeviceListResponse>(`/api/devices?${qs.toString()}`),
    ...REFETCH,
  });
}

export function useDevice(devEui: string) {
  return useQuery({
    queryKey: ['device', devEui],
    queryFn: () => fetchJson<DeviceDetail>(`/api/devices/${devEui}`),
    ...REFETCH,
  });
}

export function useDeviceMetric(devEui: string, metric: string, from: string) {
  return useQuery({
    queryKey: ['device-metric', devEui, metric, from],
    queryFn: () => fetchJson<SeriesResult>(`/api/devices/${devEui}/metrics?metric=${metric}&from=${from}`),
    ...REFETCH,
  });
}

export function useFleetMetric(metric: string, from: string) {
  return useQuery({
    queryKey: ['fleet-metric', metric, from],
    queryFn: () => fetchJson<SeriesResult>(`/api/metrics?metric=${metric}&from=${from}`),
    ...REFETCH,
  });
}

export interface BusylightPayload {
  red: number; green: number; blue: number; ontime: number; offtime: number;
}

/** Sends a Kuando Busylight downlink for a device; throws with the server message on failure. */
export async function sendBusylightDownlink(devEui: string, payload: BusylightPayload): Promise<void> {
  const res = await fetch(`${BASE}api/devices/${devEui}/downlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? `${res.status} ${res.statusText}`);
  }
}

export interface DownlinkManyResult {
  sent: number;
  failed: number;
  results: { dev_eui: string; ok: boolean; message?: string }[];
}

/** Sends the same Busylight downlink to many devices; throws with the server message on failure. */
export async function sendBusylightDownlinkMany(
  devEuis: string[],
  payload: BusylightPayload,
): Promise<DownlinkManyResult> {
  const res = await fetch(`${BASE}api/downlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_euis: devEuis, ...payload }),
  });
  const data = await res.json().catch(() => ({})) as DownlinkManyResult & { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `${res.status} ${res.statusText}`);
  }
  return data;
}

export function useDeviceEvents(devEui: string, from: string) {
  return useQuery({
    queryKey: ['events', devEui, from],
    queryFn: () => fetchJson<SeriesResult>(`/api/devices/${devEui}/events?from=${from}`),
    ...REFETCH,
  });
}

export function useDeviceUplinks(devEui: string, from: string) {
  return useQuery({
    queryKey: ['uplinks', devEui, from],
    queryFn: () => fetchJson<{ items: UplinkRow[] }>(`/api/devices/${devEui}/uplinks?from=${from}&limit=100`),
    ...REFETCH,
  });
}

export function useDeviceDownlinks(devEui: string, from: string) {
  return useQuery({
    queryKey: ['downlinks', devEui, from],
    queryFn: () => fetchJson<{ items: DownlinkGroup[] }>(`/api/devices/${devEui}/downlinks?from=${from}&limit=100`),
    ...REFETCH,
  });
}

export function useDeviceJoins(devEui: string, from: string) {
  return useQuery({
    queryKey: ['joins', devEui, from],
    queryFn: () => fetchJson<{ items: JoinRow[] }>(`/api/devices/${devEui}/joins?from=${from}`),
    ...REFETCH,
  });
}

export function useRecentJoins() {
  return useQuery({
    queryKey: ['recent-joins'],
    queryFn: () => fetchJson<{ items: JoinRow[] }>('/api/joins?from=24h&limit=20'),
    ...REFETCH,
  });
}
