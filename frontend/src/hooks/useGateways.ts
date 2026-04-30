import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { Gateway } from '../api/types';
import { useSettings } from '../store/settings';

export function useGateways() {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery<{ items: Gateway[] }>({
    queryKey: ['gateways'],
    queryFn: () => apiFetch('/api/gateways'),
    enabled: !!apiKey,
    staleTime: 30_000,
  });
}

export function useGateway(eui: string | undefined) {
  return useQuery({
    queryKey: ['gateway', eui],
    queryFn: () => apiFetch<{ gateway: Gateway }>(`/api/gateways/${eui}`),
    enabled: !!eui,
    staleTime: 10_000,
  });
}
