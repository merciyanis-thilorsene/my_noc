import { ReactNode } from 'react';
import { LinkHealth } from '../lib/link';

/** Warning triangle shown for devices whose RF link needs action; hover for the reason. */
export function AlertIcon({ health }: { health: LinkHealth }) {
  if (health.level === 'ok') return null;
  return (
    <span className={`alert ${health.level}`} title={health.reasons.join(' · ')} aria-label="needs action">
      ⚠
    </span>
  );
}

export function Kpi({ label, value, sub, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'crit';
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub !== undefined ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export const RANGES = ['6h', '24h', '7d', '30d', '90d', '180d'] as const;
export type Range = typeof RANGES[number];
export const RANGE_LABEL: Record<Range, string> = {
  '6h': '6h', '24h': '24h', '7d': '7d', '30d': '30d', '90d': '90d', '180d': '6mo',
};

export function TimeRange({ value, onChange, options = RANGES }: {
  value: string; onChange: (r: Range) => void; options?: readonly Range[];
}) {
  return (
    <div className="seg">
      {options.map((r) => (
        <button
          key={r}
          type="button"
          className={value === r ? 'active' : ''}
          onClick={() => onChange(r)}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ lastSeen, medianMins }: { lastSeen: string; medianMins?: number | null }) {
  const ageMs = Date.now() - Date.parse(lastSeen);
  // Silent if no traffic for > 3x typical interval (fallback: 1h).
  const thresholdMs = (medianMins ?? 20) * 60_000 * 3;
  const silent = ageMs > thresholdMs;
  return (
    <span className={`badge ${silent ? 'silent' : 'active'}`}>
      {silent ? 'silent' : 'active'}
    </span>
  );
}

export function StatusDot({ lastSeen }: { lastSeen: string }) {
  const silent = Date.now() - Date.parse(lastSeen) > 60 * 60_000;
  return <span className={`dot ${silent ? 'silent' : 'active'}`} title={silent ? 'silent' : 'active'} />;
}

const SF_VARS: Record<number, string> = {
  7: '--sf7', 8: '--sf8', 9: '--sf9', 10: '--sf10', 11: '--sf11', 12: '--sf12',
};

export function SfBadge({ sf }: { sf: number | null }) {
  if (sf === null) return <span className="muted">—</span>;
  const color = `var(${SF_VARS[sf] ?? '--text-2'})`;
  return <span className="pill" style={{ color, borderColor: color }}>{`SF${sf}`}</span>;
}

export function lossTone(pct: number | null): 'ok' | 'warn' | 'crit' | undefined {
  if (pct === null) return undefined;
  if (pct >= 10) return 'crit';
  if (pct >= 2) return 'warn';
  return 'ok';
}
