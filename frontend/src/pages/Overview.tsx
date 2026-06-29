import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useDevices, useFleetMetric, useOverview, useRecentJoins,
} from '../api';
import {
  Kpi, TimeRange, Range, lossTone,
} from '../components/ui';
import SeriesChart from '../components/SeriesChart';
import {
  aligned, barOptions, lineOptions, stackData, stackOptions, toUplotData,
} from '../lib/uplot';
import {
  CSS, int, num, pct, rate, ago,
} from '../lib/format';

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
        <h1>Fleet Overview</h1>
        <div className="spacer" style={{ flex: 1 }} />
        <TimeRange value={range} onChange={setRange} />
      </div>

      <div className="kpis">
        <Kpi label="Devices" value={int(d?.total_devices)} sub={`${int(d?.active_devices_24h)} active · ${int(d?.silent_devices_24h)} silent (24h)`} />
        <Kpi label="Uplinks 24h" value={int(d?.total_uplinks_24h)} />
        <Kpi label="Downlinks 24h" value={int(d?.total_downlinks_24h)} sub={`success ${rate(d?.downlink_success_rate_24h)}`} />
        <Kpi label="Avg packet loss" value={pct(d?.avg_packet_loss_pct)} tone={lossTone(d?.avg_packet_loss_pct ?? null)} />
        <Kpi label="Avg RSSI" value={num(d?.avg_rssi)} sub="dBm" />
        <Kpi label="Avg SNR" value={num(d?.avg_snr)} sub="dB" />
      </div>

      <div className="charts two">
        <SeriesChart
          q={traffic}
          title="Uplinks per bucket"
          build={(s) => ({ options: barOptions('uplinks', CSS('--accent')), data: toUplotData(s, ['count']) })}
        />
        <SeriesChart
          q={loss}
          title="Fleet packet loss %"
          build={(s) => ({
            options: lineOptions([{ key: 'loss_rate', label: 'loss', color: CSS('--crit'), fill: `${CSS('--crit')}22` }], '%'),
            // loss_rate is a fraction → render as %
            data: aligned(s.map((p) => Date.parse(p.t) / 1000), s.map((p) => {
              const v = (p as Record<string, unknown>).loss_rate;
              return typeof v === 'number' ? v * 100 : null;
            })),
          })}
        />
        <SeriesChart
          q={active}
          title="Active devices"
          build={(s) => ({ options: lineOptions([{ key: 'count', label: 'devices', color: CSS('--ok'), fill: `${CSS('--ok')}22` }]), data: toUplotData(s, ['count']) })}
        />
        <SeriesChart
          q={sf}
          title="SF distribution"
          legend={SF_DEFS.map((x) => ({ label: x.label, color: x.color }))}
          build={(s) => ({ options: stackOptions(SF_DEFS), data: stackData(s, SF_DEFS.map((x) => x.key)) })}
        />
      </div>

      <div className="charts two" style={{ marginTop: 12 }}>
        <WorstTable title="Worst packet loss" rows={worstLoss.data?.items ?? []} kind="loss" />
        <WorstTable title="Weakest RSSI" rows={worstRssi.data?.items ?? []} kind="rssi" />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Recent joins (24h)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Device</th><th>DevEUI</th><th>DevAddr</th></tr>
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
                ? <tr><td colSpan={4} className="empty">No joins in the last 24h</td></tr> : null}
            </tbody>
          </table>
        </div>
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
              <th>Device</th>
              <th className="num">{kind === 'loss' ? 'Loss %' : 'RSSI'}</th>
              <th className="num">Uplinks 24h</th>
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
            {top.length === 0 ? <tr><td colSpan={3} className="empty">No devices yet</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
