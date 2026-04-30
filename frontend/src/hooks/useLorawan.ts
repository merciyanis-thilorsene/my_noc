import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchColorState,
  fetchLorawanStats,
  postAdrOff,
  postForceSf8,
  postSetColor,
} from '../api/lorawan';
import { useSettings } from '../store/settings';

export function useLorawanStats() {
  const apiKey = useSettings((s) => s.apiKey);
  return useQuery({
    queryKey: ['lorawan', 'stats'],
    queryFn: fetchLorawanStats,
    enabled: !!apiKey,
    staleTime: 15_000,
  });
}

export function useColorState(devEui: string | undefined) {
  return useQuery({
    queryKey: ['lorawan', 'color', devEui],
    queryFn: () => fetchColorState(devEui!),
    enabled: !!devEui,
    // 404 here means "no color state yet" — surface that as data:null instead
    // of letting react-query retry the request.
    retry: false,
    staleTime: 5_000,
  });
}

// Invalidate the queries that may have changed after an action, so the UI
// refreshes its counters and per-device state without a manual refetch.
function invalidateAfterAction(qc: ReturnType<typeof useQueryClient>, devEui: string): void {
  void qc.invalidateQueries({ queryKey: ['lorawan', 'stats'] });
  void qc.invalidateQueries({ queryKey: ['lorawan', 'color', devEui] });
  void qc.invalidateQueries({ queryKey: ['alerts'] });
  void qc.invalidateQueries({ queryKey: ['devices'] });
}

export function useForceSf8() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (devEui: string) => postForceSf8(devEui),
    onSuccess: (_data, devEui) => invalidateAfterAction(qc, devEui),
  });
}

export function useAdrOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (devEui: string) => postAdrOff(devEui),
    onSuccess: (_data, devEui) => invalidateAfterAction(qc, devEui),
  });
}

export function useSetColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ devEui, color }: { devEui: string; color: string }) =>
      postSetColor(devEui, color),
    onSuccess: (_data, vars) => invalidateAfterAction(qc, vars.devEui),
  });
}
