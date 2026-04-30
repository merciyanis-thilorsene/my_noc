import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

type Response = {
  gateway_eui: string;
  from: string;
  to: string;
  points: Array<{
    bucket: string;
    cpu_pct_avg: number | null;
    ram_pct_avg: number | null;
    temperature_c_avg: number | null;
    ping_rtt_ms_avg: number | null;
    connection_status: string | null;
  }>;
};

export function useGatewayMetrics(eui: string | undefined) {
  return useQuery<Response>({
    queryKey: ['gateway-metrics', eui],
    queryFn: () => apiFetch(`/api/gateways/${eui}/metrics`),
    enabled: !!eui,
    staleTime: 30_000,
  });
}
