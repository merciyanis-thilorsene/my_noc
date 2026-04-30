// Alert thresholds. Promoted to env later if operators want tuning without rebuilds.
export const thresholds = {
  gateway_high_temp_c: 75,
  gateway_high_cpu_pct: 85,
  gateway_high_ram_pct: 90,
  device_silent_minutes: 60,
  device_poor_signal_rssi: -110,
  device_poor_signal_min_samples: 5,
  device_poor_signal_window_hours: 1,
} as const;
