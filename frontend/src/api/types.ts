export type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
  startedAt: string;
  uptime_s: number;
  dependencies: {
    database: 'ok' | 'down';
    redis: 'ok' | 'down';
    tts: 'configured' | 'not_configured';
    wmc: 'configured' | 'not_configured';
    ml_service: 'configured' | 'not_deployed';
  };
};

export type OverviewResponse = {
  generatedAt: string;
  fleet: {
    gateways: { operational: number; unreachable: number; unknown: number; total: number };
    devices:  { active: number; inactive: number; low_battery: number; silent: number; total: number };
  };
  traffic: { uplinks_last_minute: number };
  alerts: {
    by_severity: { info: number; warning: number; critical: number };
    total: number;
  };
  network_health_score: number;
  rf: {
    health_score: number | null;
    rssi_avg: number | null;
    snr_avg: number | null;
    samples: number;
  };
  sf_distribution: Array<{ sf: number; count: number; pct: number }>;
};

export type Gateway = {
  gateway_eui: string;
  gateway_id?: string | null;
  name?: string | null;
  description?: string | null;
  frequency_plan_id?: string | null;
  customer_id?: number | null;
  location?: unknown;
  connection_status?: string | null;
  cpu_pct?: number | null;
  ram_pct?: number | null;
  temperature_c?: number | null;
  ping_rtt_ms?: number | null;
  backhaul_type?: string | null;
  firmware_version?: string | null;
  uptime_s?: number | null;
  last_kpi_at?: string | null;
  tts_source?: boolean;
  wmc_source?: boolean;
  [k: string]: unknown;
};

export type Device = {
  dev_eui: string;
  device_id?: string | null;
  app_id?: string | null;
  name?: string | null;
  description?: string | null;
  last_seen?: string | null;
  last_rssi?: number | null;
  last_snr?: number | null;
  last_sf?: number | null;
  last_f_cnt_up?: number | null;
  gateway_count?: number | null;
  rf_quality?: number | null;
  loss_pct_1h?: number | null;
  [k: string]: unknown;
};

export type Alert = {
  id: number;
  severity: 'info' | 'warning' | 'critical';
  source: 'TTS' | 'WMC' | 'DERIVED' | 'ML';
  entity_type: 'gateway' | 'device' | 'network';
  entity_id: string;
  rule_name: string;
  message: string;
  raised_at: string;
  cleared_at: string | null;
  details?: Record<string, unknown> | null;
};
