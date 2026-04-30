import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { OverviewResponse } from '../api/types';
import { useSettings } from '../store/settings';

export function useOverview() {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery<OverviewResponse>({
    queryKey: ['overview'],
    queryFn: () => apiFetch<OverviewResponse>('/api/overview'),
    enabled: !!apiKey,
    refetchInterval: 30_000,
  });
}
