import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { HealthResponse } from '../api/types';

export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
    refetchInterval: 15_000,
    retry: 0,
  });
}
