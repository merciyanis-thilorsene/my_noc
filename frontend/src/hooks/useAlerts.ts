import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { Alert } from '../api/types';
import { useSettings } from '../store/settings';

export function useAlerts(status: 'active' | 'cleared' | 'all' = 'all') {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery<{ items: Alert[] }>({
    queryKey: ['alerts', status],
    queryFn: () =>
      apiFetch(`/api/alerts${status !== 'all' ? `?status=${status}` : ''}`),
    enabled: !!apiKey,
    staleTime: 20_000,
  });
}
