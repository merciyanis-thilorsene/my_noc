import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useConfig, useGateways, useRecentAlerts, type GatewayAlert, type GatewayListItem,
} from '../api';
import { gatewayName, isSilent, mapPosition, rssiColor, statusMeta } from '../lib/gateways';
import { ago, int, num } from '../lib/format';
import GatewayMap from '../components/gateways/GatewayMap';
import GatewayDrawer from '../components/gateways/GatewayDrawer';
import { L } from '../lib/i18n';

type Filter = 'all' | 'ok' | 'warning' | 'unreachable' | 'stale' | 'silent';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: L.gw.fAll },
  { id: 'ok', label: L.gw.fOk },
  { id: 'warning', label: L.gw.fWarn },
  { id: 'unreachable', label: L.gw.fUnreach },
  { id: 'stale', label: L.gw.fStale },
  { id: 'silent', label: L.gw.fSilent },
];

function matches(g: GatewayListItem, f: Filter): boolean {
  const meta = statusMeta(g);
  switch (f) {
    case 'ok': return meta.key === 'ok' && !isSilent(g);
    case 'warning': return meta.key === 'warning';
    case 'unreachable': return meta.key === 'unreachable';
    case 'stale': return meta.key === 'stale';
    case 'silent': return isSilent(g);
    default: return true;
  }
}

function alertVisual(a: GatewayAlert): { icon: string; color: string; tag: 'error' | 'alert' | 'success'; label: string } {
  if (a.cleared_at !== null) return { icon: 'check_circle', color: 'var(--ok)', tag: 'success', label: L.gw.sevResolved };
  if (a.severity === 'critical') return { icon: 'error', color: 'var(--crit)', tag: 'error', label: L.gw.sevCritical };
  return { icon: 'warning', color: 'var(--warn)', tag: 'alert', label: L.gw.sevAlert };
}

export default function Gateways() {
  const [params, setParams] = useSearchParams();
  const config = useConfig();
  const q = useGateways();
  const alertsQ = useRecentAlerts();

  const gateways = useMemo(() => q.data?.items ?? [], [q.data?.items]);
  const filter = (params.get('f') ?? 'all') as Filter;
  const openEui = params.get('gw');

  const setFilter = (f: Filter) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (f === 'all') next.delete('f'); else next.set('f', f);
      return next;
    }, { replace: true });
  };
  const openGateway = (gwEui: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (gwEui === null) next.delete('gw'); else next.set('gw', gwEui);
      return next;
    }, { replace: true });
  };

  const silentList = gateways.filter(isSilent);
  const summary = {
    total: gateways.length,
    ok: gateways.filter((g) => statusMeta(g).key === 'ok' && !isSilent(g)).length,
    warning: gateways.filter((g) => statusMeta(g).key === 'warning').length,
    unreachable: gateways.filter((g) => statusMeta(g).key === 'unreachable').length,
    stale: gateways.filter((g) => statusMeta(g).key === 'stale').length,
    silent: silentList.length,
    customers: new Set(gateways.map((g) => g.customer_id).filter((c) => c !== null)).size,
  };
  const lastPoll = gateways.reduce<string | null>(
    (max, g) => (g.last_polled_at !== null && (max === null || g.last_polled_at > max) ? g.last_polled_at : max),
    null,
  );

  const rows = useMemo(() => {
    const filtered = gateways.filter((g) => matches(g, filter));
    return [...filtered].sort((a, b) => (Number(isSilent(b)) - Number(isSilent(a)))
      || (b.active_alerts - a.active_alerts)
      || (b.uplinks_relayed - a.uplinks_relayed));
  }, [gateways, filter]);

  const openRow = openEui !== null ? gateways.find((g) => g.gw_eui === openEui) ?? null : null;
  const wmcEnabled = config.data?.wmc_enabled ?? false;
  const feed = (alertsQ.data?.items ?? []).slice(0, 10);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{L.gw.title}</h1>
          <div className="sub">{L.gw.subtitle(summary.total, summary.customers, wmcEnabled)}</div>
        </div>
        <div className="spacer" />
        <div className="pill" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
          <span className="icon" style={{ fontSize: 16, color: 'var(--text-3)' }}>sync</span>
          {wmcEnabled
            ? (lastPoll !== null ? L.gw.pollActive(ago(lastPoll)) : L.gw.pollEvery(config.data?.wmc_poll_interval_sec ?? 300))
            : L.gw.pollInactive}
        </div>
      </div>

      {/* KPI strip */}
      <div className="gw-kpis">
        <div className="kpi clickable" onClick={() => setFilter('ok')}>
          <div className="label"><span className="dot" style={{ background: 'var(--dot-ok)' }} />{L.gw.kpiOk}</div>
          <div className="value">{int(summary.ok)}</div>
          <div className="sub">{L.gw.kpiOkSub(summary.total)}</div>
        </div>
        <div className="kpi clickable" onClick={() => setFilter('warning')}>
          <div className="label"><span className="dot" style={{ background: 'var(--dot-warn)' }} />{L.gw.kpiWarn}</div>
          <div className="value">{int(summary.warning)}</div>
          <div className="sub">{L.gw.kpiWarnSub}</div>
        </div>
        <div className="kpi clickable" onClick={() => setFilter('unreachable')}>
          <div className="label"><span className="dot" style={{ background: 'var(--dot-crit)' }} />{L.gw.kpiUnreach}</div>
          <div className="value" style={{ color: summary.unreachable > 0 ? 'var(--crit)' : undefined }}>{int(summary.unreachable)}</div>
          <div className="sub">{L.gw.kpiUnreachSub}</div>
        </div>
        <div className="kpi clickable" onClick={() => setFilter('stale')}>
          <div className="label"><span className="icon" style={{ fontSize: 15, color: 'var(--text-3)' }}>schedule</span>{L.gw.kpiStale}</div>
          <div className="value">{int(summary.stale)}</div>
          <div className="sub">{L.gw.kpiStaleSub}</div>
        </div>
        <div className="kpi clickable anomaly" onClick={() => setFilter('silent')}>
          <div className="label"><span className="icon" style={{ fontSize: 16 }}>warning</span>{L.gw.kpiSilent}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="value">{int(summary.silent)}</div>
            <span style={{ fontSize: 11, color: 'var(--berry-text)' }}>{L.gw.kpiSilentSub}</span>
          </div>
          <div className="sub">{L.gw.kpiSilentHint}</div>
        </div>
      </div>

      {/* Map + rail */}
      <div className="gw-main">
        <div className="panel" style={{ minHeight: 440 }}>
          <div className="panel-head">
            <span className="icon">public</span>
            <b>{L.gw.map}</b>
            <span className="hint">{L.gw.mapHint}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--text-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ width: 9, height: 9, background: '#00b78f' }} />{L.gw.legendOk}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ width: 9, height: 9, background: '#ff9d00' }} />{L.gw.legendWarn}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ width: 9, height: 9, background: '#ff425d' }} />{L.gw.legendUnreach}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ width: 9, height: 9, background: '#fff', border: '2px solid #f44b83' }} />{L.gw.legendSilent}</span>
            </div>
          </div>
          {config.data !== undefined ? (
            <GatewayMap gateways={gateways} tileUrl={config.data.map_tile_url} onOpen={openGateway} />
          ) : <div className="loading">{L.gw.mapLoading}</div>}
        </div>

        <div className="rail">
          <div className="panel watchlist">
            <div className="panel-head">
              <span className="icon" style={{ fontSize: 17 }}>crisis_alert</span>
              <b>{L.gw.watchlist}</b>
              <span className="count-pill">{int(summary.silent)}</span>
            </div>
            {silentList.map((g) => (
              <div key={g.gw_eui} className="row-item" onClick={() => openGateway(g.gw_eui)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gatewayName(g)}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{g.gw_eui}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 13, color: 'var(--berry-text)' }}>0 / 24h</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{L.gw.heardAgo(ago(g.last_heard_at))}</div>
                </div>
                <span className="icon" style={{ fontSize: 16, color: 'var(--text-3)' }}>chevron_right</span>
              </div>
            ))}
            {silentList.length === 0 ? <div className="empty" style={{ padding: 16 }}>{L.gw.watchlistEmpty}</div> : null}
          </div>

          <div className="panel" style={{ flex: 1, overflow: 'hidden' }}>
            <div className="panel-head">
              <span className="live-dot" style={{ background: 'var(--dot-crit)' }} />
              <b style={{ fontSize: 13 }}>{L.gw.feed}</b>
              <span className="hint">{L.gw.feedHint}</span>
            </div>
            <div className="noc-scroll" style={{ overflow: 'auto', flex: 1 }}>
              {feed.map((a) => {
                const v = alertVisual(a);
                return (
                  <div key={a.id} className="row-item" style={{ padding: '10px 16px', alignItems: 'flex-start' }} onClick={() => openGateway(a.gw_eui)}>
                    <span className="icon" style={{ fontSize: 18, color: v.color, marginTop: 1 }}>{v.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{a.alert_type}</span>
                        <span className={`tag ${v.tag}`}><i />{v.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.gateway_name ?? a.site_name ?? a.gw_eui}
                        {' · '}
                        <span className="mono" style={{ fontSize: 10 }}>{a.gw_eui}</span>
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{ago(a.raised_at)}</span>
                  </div>
                );
              })}
              {alertsQ.data !== undefined && feed.length === 0 ? (
                <div className="empty">{L.gw.feedEmpty}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Fleet table */}
      <div className="panel">
        <div className="panel-head">
          <b>{L.gw.fleet}</b>
          <span className="pill">{int(rows.length)}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`fpill${filter === f.id ? ' active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <div style={{ minWidth: 1000 }}>
            <div className="gwt-head">
              <div>{L.gw.colStatus}</div>
              <div>gw_eui</div>
              <div>{L.gw.colGateway}</div>
              <div>{L.gw.colHeard}</div>
              <div className="gwt-right">{L.gw.colUplinks}</div>
              <div className="gwt-right">{L.gw.colDevices}</div>
              <div className="gwt-right">{L.gw.colRssi}</div>
              <div className="gwt-right">{L.gw.colAlerts}</div>
            </div>
            {rows.map((g) => {
              const meta = statusMeta(g);
              const silent = isSilent(g);
              const located = mapPosition(g) !== null;
              return (
                <div key={g.gw_eui} className="gwt-row" onClick={() => openGateway(g.gw_eui)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`tag ${meta.tag}`}><i />{meta.label}</span>
                    {silent ? <span className="silence-chip"><span className="icon">warning</span>{L.gw.silenceChip}</span> : null}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.gw_eui}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {gatewayName(g)}
                      {!located ? <span className="icon" title={L.gw.noCoords} style={{ fontSize: 13, color: 'var(--text-3)' }}>location_on</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{g.site_name ?? g.deployment_address ?? '—'}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>{ago(g.last_heard_at)}</div>
                  <div className="gwt-right mono" style={{ fontSize: 13, color: silent ? 'var(--berry-text)' : g.uplinks_relayed === 0 ? 'var(--crit)' : 'var(--text-1)' }}>
                    {int(g.uplinks_relayed)}
                  </div>
                  <div className="gwt-right mono" style={{ fontSize: 12 }}>{int(g.devices_heard)}</div>
                  <div className="gwt-right mono" style={{ fontSize: 12, color: g.avg_rssi !== null ? rssiColor(g.avg_rssi) : 'var(--text-3)' }}>
                    {g.avg_rssi !== null ? num(g.avg_rssi, 0) : '—'}
                  </div>
                  <div className="gwt-right">
                    {g.active_alerts > 0
                      ? <span className="badge crit mono" style={{ borderRadius: 9999 }}>{int(g.active_alerts)}</span>
                      : <span style={{ color: 'var(--border)' }}>—</span>}
                  </div>
                </div>
              );
            })}
            {q.isLoading ? <div className="loading">{L.common.loading}</div> : null}
            {!q.isLoading && rows.length === 0 ? (
              <div className="empty">
                {filter === 'all' ? L.gw.emptyAll : L.gw.emptyFilter}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {openRow !== null ? (
        <GatewayDrawer row={openRow} wmcEnabled={wmcEnabled} onClose={() => openGateway(null)} />
      ) : null}
    </div>
  );
}
