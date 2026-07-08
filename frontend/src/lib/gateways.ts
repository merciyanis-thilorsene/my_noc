import type { GatewayListItem } from '../api';
import { L } from './i18n';

/** Visual identity of an effective (NOC-derived) gateway status. */
export interface StatusMeta {
  key: 'ok' | 'warning' | 'unreachable' | 'unknown' | 'stale' | 'nowmc';
  label: string;
  tag: 'success' | 'alert' | 'error' | 'muted';
  color: string;
}

/**
 * Effective status: WMC's enum refined by the NOC-derived stale flag, with a distinct
 * "Hors WMC" identity for gateways known only from observed traffic.
 */
export function statusMeta(g: Pick<GatewayListItem, 'status' | 'stale'>): StatusMeta {
  if (g.status === 'Unreachable') {
    return { key: 'unreachable', label: L.status.unreachable, tag: 'error', color: '#ff425d' };
  }
  if (g.status === 'Unknown') {
    return { key: 'unknown', label: L.status.unknown, tag: 'muted', color: '#929292' };
  }
  if (g.status === null) {
    return { key: 'nowmc', label: L.status.noWmc, tag: 'muted', color: '#9bb6d3' };
  }
  if (g.stale) {
    return { key: 'stale', label: L.status.stale, tag: 'muted', color: '#818181' };
  }
  if (g.status === 'Warning') {
    return { key: 'warning', label: L.status.warning, tag: 'alert', color: '#ff9d00' };
  }
  return { key: 'ok', label: L.status.operational, tag: 'success', color: '#00b78f' };
}

/**
 * The §B.9 transition anomaly: WMC says Operational (and the status isn't stale), the
 * gateway HAS been heard before, but relayed nothing in the window. "Never heard" is
 * deliberately excluded — a gateway with no device in range legitimately hears nothing.
 */
export function isSilent(g: GatewayListItem): boolean {
  return g.status === 'Operational' && !g.stale
    && g.uplinks_relayed === 0 && g.last_heard_at !== null;
}

/** Where to place the gateway on the map: deployment position first, WMC fallback. */
export function mapPosition(g: GatewayListItem): [number, number] | null {
  if (g.deployment_lat !== null && g.deployment_lng !== null) {
    return [g.deployment_lat, g.deployment_lng];
  }
  if (g.wmc_latitude !== null && g.wmc_longitude !== null) {
    return [g.wmc_latitude, g.wmc_longitude];
  }
  return null;
}

/** RSSI severity color, theme-aware via the status tokens. */
export function rssiColor(v: number | null): string {
  if (v === null) return 'var(--text-3)';
  if (v > -95) return 'var(--ok)';
  if (v > -110) return 'var(--warn)';
  return 'var(--crit)';
}

/** Display name: operator site name, WMC name, else the EUI itself. */
export function gatewayName(g: Pick<GatewayListItem, 'name' | 'site_name' | 'gw_eui'>): string {
  return g.name ?? g.site_name ?? g.gw_eui;
}
