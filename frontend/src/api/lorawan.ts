import { apiFetch } from './client';

export type LorawanStats = {
  devices: { total: number; on_sf12: number; adr_enabled: number };
  commands: {
    pending: { color: number; adr_off: number; keepalive: number };
    failed_24h: number;
  };
  alerts: Array<{ rule_name: string; severity: string; count: number }>;
};

export type ColorState = {
  device_eui: string;
  desired:    { hex: string; name: string | null } | null;
  last_acked: { hex: string; name: string | null } | null;
  pending_command:
    | {
        id: string;
        command_type: string;
        attempts: number;
        max_attempts: number;
        next_attempt_at: string;
        created_at: string;
        details: Record<string, unknown> | null;
      }
    | null;
};

export type ActionAck = {
  ok?: boolean;
  device_eui: string;
  device_id?: string;
  command_id?: string;
  next_attempt_at?: string;
  color?: { hex: string; name: string | null };
};

export const fetchLorawanStats = (): Promise<LorawanStats> =>
  apiFetch<LorawanStats>('/api/lorawan/stats');

export const fetchColorState = (devEui: string): Promise<ColorState> =>
  apiFetch<ColorState>(`/api/lorawan/devices/${devEui}/color`);

export const postForceSf8 = (devEui: string): Promise<ActionAck> =>
  apiFetch<ActionAck>(`/api/lorawan/devices/${devEui}/force-sf8`, { method: 'POST' });

export const postAdrOff = (devEui: string): Promise<ActionAck> =>
  apiFetch<ActionAck>(`/api/lorawan/devices/${devEui}/adr-off`, { method: 'POST' });

export const postSetColor = (devEui: string, color: string): Promise<ActionAck> =>
  apiFetch<ActionAck>(`/api/lorawan/devices/${devEui}/color`, {
    method: 'POST',
    body: JSON.stringify({ color }),
  });
