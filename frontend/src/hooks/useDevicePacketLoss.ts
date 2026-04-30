import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type PacketLossResponse = {
  dev_eui: string;
  from: string;
  to: string;
  bucket: string;
  totals: { received: number; expected: number; loss_pct: number };
  points: Array<{ bucket: string; received: number; expected: number; loss_pct: number }>;
};

export function useDevicePacketLoss(devEui: string | undefined, hours = 24) {
  return useQuery<PacketLossResponse>({
    queryKey: ['device-loss', devEui, hours],
    queryFn: () => apiFetch(`/api/devices/${devEui}/packet-loss?hours=${hours}`),
    enabled: !!devEui,
    staleTime: 30_000,
  });
}
