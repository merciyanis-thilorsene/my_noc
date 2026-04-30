import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useSettings } from '../store/settings';

export type TrafficPoint = { bucket: string; uplinks: number };

export function useTraffic(hours = 24) {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery<{ from: string; bucket: string; points: TrafficPoint[] }>({
    queryKey: ['traffic', hours],
    queryFn: () => apiFetch(`/api/traffic?hours=${hours}`),
    enabled: !!apiKey,
    refetchInterval: 60_000,
  });
}
