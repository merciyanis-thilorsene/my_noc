import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { Device } from '../api/types';
import { useSettings } from '../store/settings';

export function useDevices() {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery<{ items: Device[] }>({
    queryKey: ['devices'],
    queryFn: () => apiFetch('/api/devices'),
    enabled: !!apiKey,
    staleTime: 30_000,
  });
}

export function useDevice(devEui: string | undefined) {
  return useQuery({
    queryKey: ['device', devEui],
    queryFn: () => apiFetch(`/api/devices/${devEui}`),
    enabled: !!devEui,
    staleTime: 10_000,
  });
}
