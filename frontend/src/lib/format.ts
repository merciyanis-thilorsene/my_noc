import { L } from './i18n';

export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Math.round(value).toLocaleString(L.locale);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

export function rate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/** Compact relative "time ago" (localized) for last-seen columns. */
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return L.timeAgo(Math.floor(ms / 1000));
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(L.locale, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function freqMhz(hz: number | null): string {
  if (hz === null) return '—';
  return `${(hz / 1_000_000).toFixed(1)}`;
}

export const CSS = (name: string): string => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim() || '#888';
