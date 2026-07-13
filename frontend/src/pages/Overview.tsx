import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useDevices, useFleetMetric, useOverview, useRecentJoins, useRedundancy,
} from '../api';
import {
  Kpi, TimeRange, Range, lossTone,
} from '../components/ui';
import SeriesChart from '../components/SeriesChart';
import {
  barOptions, lineOptions, lossData, lossOptions, stackData, stackOptions, toUplotData,
} from '../lib/uplot';
import {
  CSS, int, num, pct, rate, ago,
} from '../lib/format';
import { L } from '../lib/i18n';

const SF_DEFS = [
  { key: 'sf7', label: 'SF7', color: 'var(--sf7)' },
  { key: 'sf8', label: 'SF8', color: 'var(--sf8)' },
  { key: 'sf9', label: 'SF9', color: 'var(--sf9)' },
  { key: 'sf10', label: 'SF10', color: 'var(--sf10)' },
  { key: 'sf11', label: 'SF11', color: 'var(--sf11)' },
  { key: 'sf12', label: 'SF12', color: 'var(--sf12)' },
];

export default function Overview() {
  const [range, setRange] = useState<Range>('24h');
  const o = useOverview();
  const traffic = useFleetMetric('uplink_count', range);
  const loss = useFleetMetric('packet_loss', range);
  const active = useFleetMetric('active_devices', range);
  const sf = useFleetMetric('sf_distribution', range);
  const worstLoss = useDevices('', 'loss_rate');
  const worstRssi = useDevices('', 'rssi');
  const joins = useRecentJoins();

  const d = o.data;

  return (
    <div>
      <div className="page-head">
        <h1>{L.ov.title}</h1>
        <div className="spacer" style={{ flex: 1 }} />
        <TimeRange value={range} onChange={setRange} />
      </div>

      <div className="kpis">
        <Kpi label={L.ov.kDevices} value={int(d?.total_devices)} sub={L.ov.kDevicesSub(d?.active_devices_24h ?? 0, d?.silent_devices_24h ?? 0)} />
        <Kpi label={L.ov.kUplinks} value={int(d?.total_uplinks_24h)} />
        <Kpi label={L.ov.kDownlinks} value={int(d?.total_downlinks_24h)} sub={L.ov.kDlSub(rate(d?.downlink_success_rate_24h))} />
        <Kpi label={L.ov.kLoss} value={pct(d?.avg_packet_loss_pct)} tone={lossTone(d?.avg_packet_loss_pct ?? null)} />
        <Kpi label={L.ov.kRssi} value={num(d?.avg_rssi)} sub="dBm" />
        <Kpi label={L.ov.kSnr} value={num(d?.avg_snr)} sub="dB" />
      </div>

      <div className="charts two">
        <SeriesChart
          q={traffic}
          title={L.ov.cUplinks}
          build={(s) => ({ options: barOptions('uplinks', CSS('--accent')), data: toUplotData(s, ['count']) })}
        />
        <SeriesChart
          q={loss}
          title={L.ov.cLoss}
          legend={[{ label: L.ov.cLossSeries, color: 'var(--crit)' }]}
          build={(s) => ({ options: lossOptions(), data: lossData(s) })}
        />
        <SeriesChart
          q={active}
          title={L.ov.cActive}
          build={(s) => ({ options: lineOptions([{ key: 'count', label: L.ov.cActiveSeries, color: CSS('--ok'), fill: `${CSS('--ok')}22` }]), data: toUplotData(s, ['count']) })}
        />
        <SeriesChart
          q={sf}
          title={L.ov.cSf}
          legend={SF_DEFS.map((x) => ({ label: x.label, color: x.color }))}
          build={(s) => ({ options: stackOptions(SF_DEFS), data: stackData(s, SF_DEFS.map((x) => x.key)) })}
        />
      </div>

      <div className="charts two" style={{ marginTop: 12 }}>
        <WorstTable title={L.ov.worstLoss} rows={worstLoss.data?.items ?? []} kind="loss" />
        <WorstTable title={L.ov.worstRssi} rows={worstRssi.data?.items ?? []} kind="rssi" />
      </div>

      <RedundancyCard />

      <div className="card" style={{ marginTop: 12 }}>
        <h2>{L.ov.joins}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{L.ov.colTime}</th><th>{L.ov.colDevice}</th><th>DevEUI</th><th>DevAddr</th></tr>
            </thead>
            <tbody>
              {(joins.data?.items ?? []).map((j) => (
                <tr key={j.id}>
                  <td className="muted">{ago(j.timestamp)}</td>
                  <td><Link to={`/devices/${j.dev_eui}`}>{j.device_id}</Link></td>
                  <td className="mono">{j.dev_eui}</td>
                  <td className="mono">{j.dev_addr ?? '—'}</td>
                </tr>
              ))}
              {(joins.data?.items.length ?? 0) === 0
                ? <tr><td colSpan={4} className="empty">{L.ov.joinsEmpty}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RedundancyCard() {
  const q = useRedundancy();
  const rows = q.data?.single_gateway ?? [];
  return (
    <div className="card" style={{ marginTop: 12, borderColor: rows.length > 0 ? 'var(--berry-border)' : undefined }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="icon" style={{ fontSize: 16, color: rows.length > 0 ? 'var(--berry)' : 'var(--text-3)' }}>crisis_alert</span>
        {L.ov.redundancy}
        {rows.length > 0 ? <span className="count-pill">{int(rows.length)}</span> : null}
        <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {L.ov.redundancyHint}
        </span>
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{L.ov.colDevice}</th>
              <th>{L.ov.colVia}</th>
              <th className="num">{L.ov.colUplinks}</th>
              <th>{L.ov.colHeard}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.dev_eui} className="clickable">
                <td>
                  <Link to={`/devices/${d.dev_eui}`}>{d.name ?? d.device_id ?? d.dev_eui}</Link>
                </td>
                <td>
                  <Link to={`/gateways?gw=${d.gw_eui}`} style={{ color: 'inherit' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="icon" style={{ fontSize: 14, color: 'var(--text-3)' }}>cell_tower</span>
                      {d.gw_name ?? d.gw_site_name ?? d.gw_eui}
                    </span>
                  </Link>
                </td>
                <td className="num">{int(d.uplinks)}</td>
                <td className="muted">{ago(d.last_heard_at)}</td>
              </tr>
            ))}
            {rows.length === 0
              ? <tr><td colSpan={4} className="empty">{L.ov.redundancyEmpty}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorstTable({ title, rows, kind }: {
  title: string;
  rows: import('../api').DeviceListItem[];
  kind: 'loss' | 'rssi';
}) {
  const top = rows.slice(0, 10);
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{L.ov.colDevice}</th>
              <th className="num">{kind === 'loss' ? L.ov.colLoss : 'RSSI'}</th>
              <th className="num">{L.ov.colUplinks}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.dev_eui} className="clickable">
                <td><Link to={`/devices/${r.dev_eui}`}>{r.name ?? r.device_id}</Link></td>
                <td className={`num ${kind === 'loss' ? (lossTone(r.packet_loss_pct_24h) ?? '') : ''}`}>
                  {kind === 'loss' ? pct(r.packet_loss_pct_24h) : num(r.avg_rssi_24h)}
                </td>
                <td className="num">{int(r.uplinks_24h)}</td>
              </tr>
            ))}
            {top.length === 0 ? <tr><td colSpan={3} className="empty">{L.ov.noDevices}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
