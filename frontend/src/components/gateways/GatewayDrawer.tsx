import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  syncGatewayLocation, updateGateway, useGateway, useGatewayDevices, useGatewaySeries,
  type GatewayListItem, type SyncResult,
} from '../../api';
import { gatewayName, isSilent, rssiColor, statusMeta } from '../../lib/gateways';
import { ago, int, num } from '../../lib/format';
import Sparkline from './Sparkline';
import { L } from '../../lib/i18n';

interface Callout {
  kind: 'ok' | 'warning' | 'err';
  icon: string;
  title: string;
  body: string;
  offerForce?: boolean;
}

function syncCallout(r: SyncResult): Callout {
  if (r.ok) {
    return {
      kind: 'ok',
      icon: 'check_circle',
      title: L.drawer.syncOk,
      body: r.pushed ? L.drawer.syncOkBody(r.pushed.latitude, r.pushed.longitude) : L.drawer.syncOkBodyPlain,
    };
  }
  if (r.status === 409) {
    return {
      kind: 'warning',
      icon: 'block',
      title: L.drawer.syncRefused,
      body: L.drawer.syncRefusedBody,
      offerForce: true,
    };
  }
  if (r.status === 501) {
    return {
      kind: 'warning',
      icon: 'cloud_upload',
      title: L.drawer.syncNoWmc,
      body: L.drawer.syncNoWmcBody,
    };
  }
  return {
    kind: 'err',
    icon: 'error',
    title: L.drawer.syncFailed,
    body: r.message ?? r.error ?? L.drawer.unknownError,
  };
}

/** Right-hand detail drawer for one gateway (design: 540px overlay panel). */
export default function GatewayDrawer({ row, wmcEnabled, onClose }: {
  row: GatewayListItem;
  wmcEnabled: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useGateway(row.gw_eui);
  const devices = useGatewayDevices(row.gw_eui);
  const series = useGatewaySeries(row.gw_eui);

  const [siteName, setSiteName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);

  // Re-seed the drafts whenever another gateway is opened or fresh data lands.
  const g = detail.data?.gateway ?? null;
  useEffect(() => {
    setSiteName(g?.site_name ?? '');
    setAddress(g?.deployment_address ?? '');
    setLat(g?.deployment_lat !== null && g?.deployment_lat !== undefined ? String(g.deployment_lat) : '');
    setLng(g?.deployment_lng !== null && g?.deployment_lng !== undefined ? String(g.deployment_lng) : '');
    setNotes(g?.notes ?? '');
    setCallout(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.gw_eui, detail.dataUpdatedAt]);

  const meta = statusMeta(row);
  const silent = isSilent(row);
  const observed = detail.data?.observed;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['gateways'] });
    void queryClient.invalidateQueries({ queryKey: ['gateway', row.gw_eui] });
  };

  const save = () => {
    setSaving(true);
    setCallout(null);
    const manualLat = lat.trim() === '' ? null : Number.parseFloat(lat);
    const manualLng = lng.trim() === '' ? null : Number.parseFloat(lng);
    const coordsChanged = manualLat !== (g?.deployment_lat ?? null) || manualLng !== (g?.deployment_lng ?? null);
    updateGateway(row.gw_eui, {
      site_name: siteName.trim() === '' ? null : siteName.trim(),
      deployment_address: address.trim() === '' ? null : address.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      // Only send coordinates the operator actually edited, so an unchanged pair doesn't
      // overwrite a fresh server-side geocode with the same values marked "manual".
      ...(coordsChanged && manualLat !== null && manualLng !== null
        && !Number.isNaN(manualLat) && !Number.isNaN(manualLng)
        ? { deployment_lat: manualLat, deployment_lng: manualLng }
        : {}),
    })
      .then(() => {
        setCallout({ kind: 'ok', icon: 'check_circle', title: L.drawer.saved, body: L.drawer.savedBody });
        invalidate();
      })
      .catch((e: unknown) => setCallout({
        kind: 'err', icon: 'error', title: L.drawer.saveFailed, body: e instanceof Error ? e.message : String(e),
      }))
      .finally(() => setSaving(false));
  };

  const sync = (force: boolean) => {
    setSaving(true);
    setCallout(null);
    syncGatewayLocation(row.gw_eui, force)
      .then((r) => {
        setCallout(syncCallout(r));
        if (r.ok) invalidate();
      })
      .finally(() => setSaving(false));
  };

  const coordLat = g?.deployment_lat ?? row.wmc_latitude;
  const coordLng = g?.deployment_lng ?? row.wmc_longitude;
  const source = g?.deployment_lat !== null && g?.deployment_lat !== undefined
    ? (g.deployment_coord_source ?? 'manual')
    : (row.wmc_latitude !== null ? 'wmc' : null);
  const srcLabel = source === 'manual' ? L.drawer.srcManual : source === 'geocoded' ? L.drawer.srcGeocoded : source === 'wmc' ? L.drawer.srcWmc : L.drawer.srcNone;

  const vitals = detail.data?.vitals ?? [];
  const alerts = detail.data?.alerts ?? [];

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer noc-scroll">
        <div className="drawer-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className={`tag ${meta.tag}`}><i />{meta.label}</span>
                {silent ? (
                  <span className="silence-chip"><span className="icon">warning</span>{L.drawer.silentChip}</span>
                ) : null}
              </div>
              <h2 style={{ marginTop: 9, fontSize: 20, fontWeight: 600 }}>{gatewayName(row)}</h2>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>{row.gw_eui}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {row.site_name ?? '—'}
                {row.customer_id !== null ? ` · ${L.drawer.client(row.customer_id)}` : ` · ${L.drawer.noWmcClient}`}
              </div>
            </div>
            <button type="button" className="drawer-close" onClick={onClose} aria-label={L.drawer.close}>
              <span className="icon" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <section>
            <h4>{L.drawer.vitals}</h4>
            {vitals.length > 0 ? (
              <div className="vitals">
                {vitals.map((v, i) => (
                  <div className="vital" key={`${v.name ?? i}`}>
                    <div className="k">{v.name ?? '—'}</div>
                    <div className="v">{v.value ?? '—'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="vitals">
                <div className="vital">
                  <div className="k">{L.drawer.vStatus}</div>
                  <div className="v">{row.status ?? '—'}</div>
                </div>
                <div className="vital">
                  <div className="k">{L.drawer.vLastStatus}</div>
                  <div className="v">{ago(row.last_status_at)}</div>
                </div>
                <div className="vital">
                  <div className="k">{L.drawer.vInterval}</div>
                  <div className="v">{row.message_interval !== null ? `${row.message_interval} s` : '—'}</div>
                </div>
                <div className="vital">
                  <div className="k">{L.drawer.vPolled}</div>
                  <div className="v">{ago(row.last_polled_at)}</div>
                </div>
              </div>
            )}
            {!wmcEnabled ? (
              <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                {L.drawer.wmcNotConfigured}
              </p>
            ) : null}
          </section>

          <section>
            <h4>{L.drawer.address}</h4>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="field"
                placeholder={L.drawer.siteName}
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
              <input
                className="field"
                placeholder={L.drawer.addressPh}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="field" style={{ flex: 1 }} placeholder={L.drawer.latPh} value={lat} onChange={(e) => setLat(e.target.value)} />
                <input className="field" style={{ flex: 1 }} placeholder={L.drawer.lngPh} value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
              <input
                className="field"
                placeholder={L.drawer.notesPh}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11 }}>
                <span className="muted">{L.drawer.coordinate}</span>
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  {coordLat !== null && coordLng !== null ? `${coordLat.toFixed(4)}, ${coordLng.toFixed(4)}` : '—'}
                </span>
                {source !== null ? <span className={`src-badge ${source}`}>{srcLabel}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn small" onClick={save} disabled={saving}>
                  <span className="icon">save</span>
                  {L.drawer.save}
                </button>
                <button type="button" className="btn small primary" onClick={() => sync(false)} disabled={saving}>
                  <span className="icon">cloud_upload</span>
                  {L.drawer.sync}
                </button>
              </div>
              {callout !== null ? (
                <div className={`callout ${callout.kind}`}>
                  <span className="icon">{callout.icon}</span>
                  <div className="body">
                    <b>{callout.title}</b>
                    {callout.body}
                    {callout.offerForce === true ? (
                      <div style={{ marginTop: 8 }}>
                        <button type="button" className="btn small" onClick={() => sync(true)} disabled={saving}>
                          {L.drawer.forceSync}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>{L.drawer.traffic}</h4>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                {observed ? L.drawer.trafficStat(int(observed.uplinks_relayed), int(observed.devices_heard)) : '…'}
              </span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 12px 8px' }}>
              <Sparkline
                id="up"
                color="#5d5ed9"
                values={(series.data?.series ?? []).map((p) => p.uplinks)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 10px' }}>
              <h4 style={{ margin: 0 }}>{L.drawer.rf}</h4>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                {observed && observed.avg_rssi !== null ? `${num(observed.avg_rssi, 0)} dBm · SNR ${num(observed.avg_snr)} dB` : '—'}
              </span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 12px 8px' }}>
              <Sparkline
                id="rf"
                color="#00b78f"
                values={(series.data?.series ?? []).map((p) => p.avg_rssi)}
              />
            </div>
          </section>

          <section>
            <h4>{L.drawer.devicesHeard}</h4>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {(devices.data?.items ?? []).map((d) => (
                <Link
                  key={d.dev_eui}
                  to={`/devices/${d.dev_eui}`}
                  className="row-item"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <span className="icon" style={{ fontSize: 16, color: 'var(--text-3)' }}>sensors</span>
                  <span className="mono" style={{ fontSize: 12 }}>{d.dev_eui}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name ?? d.device_id ?? ''}
                  </span>
                  <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: rssiColor(d.avg_rssi) }}>
                    {d.avg_rssi !== null ? `${num(d.avg_rssi, 0)} dBm` : '—'}
                  </span>
                </Link>
              ))}
              {devices.data !== undefined && devices.data.items.length === 0 ? (
                <div className="empty">{L.drawer.devicesHeardEmpty}</div>
              ) : null}
            </div>
          </section>

          <section>
            <h4>{L.drawer.alertHistory}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a) => {
                const active = a.cleared_at === null;
                return (
                  <div key={a.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <span
                      className="icon"
                      style={{ fontSize: 17, marginTop: 1, color: active ? (a.severity === 'critical' ? '#ce0014' : '#ba6e00') : '#008365' }}
                    >
                      {active ? (a.severity === 'critical' ? 'error' : 'warning') : 'check_circle'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.alert_type}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {ago(a.raised_at)}
                        {' → '}
                        {a.cleared_at !== null ? ago(a.cleared_at) : L.drawer.alertOngoing}
                      </div>
                    </div>
                    <span className={`tag ${active ? (a.severity === 'critical' ? 'error' : 'alert') : 'success'}`}>
                      <i />
                      {active ? L.drawer.active : L.drawer.resolved}
                    </span>
                  </div>
                );
              })}
              {alerts.length === 0 ? (
                <div style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <span className="icon" style={{ fontSize: 17, color: '#008365' }}>check_circle</span>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{L.drawer.alertNone}</div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
