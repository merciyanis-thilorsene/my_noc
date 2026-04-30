import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

type MetricsResponse = {
  dev_eui: string;
  from: string;
  bucket: string;
  points: Array<{ bucket: string; rssi_avg: number | null; snr_avg: number | null; uplinks: number }>;
};

type UplinksResponse = {
  items: Array<{
    id?: number;
    timestamp: string;
    device_eui: string;
    f_cnt_up: number | null;
    f_port: number | null;
    sf: number | null;
    best_rssi: number | null;
    best_snr: number | null;
    gateway_count: number | null;
    decoded_payload: Record<string, unknown> | null;
  }>;
};

export function useDeviceMetrics(devEui: string | undefined, hours = 24) {
  return useQuery<MetricsResponse>({
    queryKey: ['device-metrics', devEui, hours],
    queryFn: () => apiFetch(`/api/devices/${devEui}/metrics?hours=${hours}`),
    enabled: !!devEui,
    staleTime: 30_000,
  });
}

export function useDeviceUplinks(devEui: string | undefined, limit = 50) {
  return useQuery<UplinksResponse>({
    queryKey: ['device-uplinks', devEui, limit],
    queryFn: () => apiFetch(`/api/devices/${devEui}/uplinks?limit=${limit}`),
    enabled: !!devEui,
    staleTime: 15_000,
  });
}
