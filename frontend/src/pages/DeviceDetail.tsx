import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useDevice, useDeviceDownlinks, useDeviceJoins, useDeviceMetric, useDeviceUplinks, SeriesPoint,
} from '../api';
import {
  Kpi, TimeRange, Range, SfBadge, StatusBadge, lossTone,
} from '../components/ui';
import SeriesChart from '../components/SeriesChart';
import {
  aligned, barOptions, bandOptions, lineOptions, lossData, lossOptions, stackData, stackOptions, toUplotData,
} from '../lib/uplot';
import {
  ago, CSS, freqMhz, int, num, pct, rate, shortTime,
} from '../lib/format';

const KPI_WINDOW: Record<Range, string> = {
  '6h': '24h', '24h': '24h', '7d': '7d', '30d': '30d', '90d': '180d', '180d': '180d',
};

const SF_DEFS = [
  { key: 'sf7', label: 'SF7', color: 'var(--sf7)' },
  { key: 'sf8', label: 'SF8', color: 'var(--sf8)' },
  { key: 'sf9', label: 'SF9', color: 'var(--sf9)' },
  { key: 'sf10', label: 'SF10', color: 'var(--sf10)' },
  { key: 'sf11', label: 'SF11', color: 'var(--sf11)' },
  { key: 'sf12', label: 'SF12', color: 'var(--sf12)' },
];

const DL_DEFS = [
  { key: 'ack', label: 'ack', color: 'var(--ok)' },
  { key: 'sent', label: 'sent', color: 'var(--accent)' },
  { key: 'nack', label: 'nack', color: 'var(--warn)' },
  { key: 'failed', label: 'failed', color: 'var(--crit)' },
];

const xs = (s: SeriesPoint[]) => s.map((p) => Date.parse(p.t) / 1000);
const col = (s: SeriesPoint[], k: string) => s.map((p) => {
  const v = (p as Record<string, unknown>)[k];
  return typeof v === 'number' ? v : null;
});
const constLine = (s: SeriesPoint[], v: number) => s.map(() => v);
const rfLegend = (color: string) => [
  { label: 'avg', color },
  { label: 'min–max', color },
  { label: 'p95', color: 'var(--warn)' },
];

const TABS = ['Traffic', 'RF Quality', 'Network', 'Downlinks'] as const;
type Tab = typeof TABS[number];

export default function DeviceDetail() {
  const { devEui = '' } = useParams();
  const [range, setRange] = useState<Range>('24h');
  const [tab, setTab] = useState<Tab>('Traffic');

  const dev = useDevice(devEui);
  const m = dev.data?.metrics[KPI_WINDOW[range]] ?? {};
  const device = dev.data?.device;

  if (dev.isLoading) return <div className="loading">Loading device…</div>;
  if (dev.error || !device) return <div className="error">Device not found.</div>;

  return (
    <div>
      <div className="page-head">
        <Link to="/devices" className="muted">← Devices</Link>
        <h1 style={{ marginLeft: 8 }}>{device.name ?? device.device_id}</h1>
        <StatusBadge lastSeen={device.last_seen_at} />
        <div className="spacer" style={{ flex: 1 }} />
        <TimeRange value={range} onChange={setRange} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12 }}>
          <Meta label="DevEUI" value={device.dev_eui} mono />
          <Meta label="Device ID" value={device.device_id} mono />
          <Meta label="Application" value={device.application_id} mono />
          <Meta label="LoRaWAN" value={device.lorawan_version ?? '—'} />
          <Meta label="First seen" value={ago(device.first_seen_at)} />
          <Meta label="Last seen" value={ago(device.last_seen_at)} />
        </div>
      </div>

      <div className="kpis">
        <Kpi label={`Uplinks (${range})`} value={int(m.uplinks)} />
        <Kpi label="Packet loss" value={pct(m.packet_loss_pct)} tone={lossTone(m.packet_loss_pct ?? null)} />
        <Kpi label="NbTrans avg" value={num(m.n_b_trans_avg, 2)} />
        <Kpi label="Avg RSSI" value={num(m.avg_rssi)} sub="dBm" />
        <Kpi label="Avg SNR" value={num(m.avg_snr)} sub="dB" />
        <Kpi label="Gateways/uplink" value={num(m.avg_gateway_count)} />
        <Kpi label="Downlink success" value={rate(m.downlink_success_rate)} sub={`${int(m.downlinks_total)} total`} />
        <Kpi label="Airtime" value={num(m.total_airtime_s, 1)} sub="s" />
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Traffic' ? <TrafficTab devEui={devEui} from={range} /> : null}
      {tab === 'RF Quality' ? <RfTab devEui={devEui} from={range} /> : null}
      {tab === 'Network' ? <NetworkTab devEui={devEui} from={range} /> : null}
      {tab === 'Downlinks' ? <DownlinksTab devEui={devEui} from={range} /> : null}

      <Tables devEui={devEui} from={range} />
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className={mono ? 'mono' : ''}>{value}</div>
    </div>
  );
}

function TrafficTab({ devEui, from }: { devEui: string; from: string }) {
  const count = useDeviceMetric(devEui, 'uplink_count', from);
  const loss = useDeviceMetric(devEui, 'packet_loss', from);
  const inter = useDeviceMetric(devEui, 'inter_arrival', from);
  return (
    <div className="charts two">
      <SeriesChart q={count} title="Uplinks per bucket" build={(s) => ({ options: barOptions('uplinks', CSS('--accent')), data: toUplotData(s, ['count']) })} />
      <SeriesChart
        q={loss}
        title="Packet loss %"
        legend={[{ label: 'loss %', color: 'var(--crit)' }]}
        build={(s) => ({ options: lossOptions(), data: lossData(s) })}
      />
      <SeriesChart
        q={inter}
        title="Inter-arrival time (s)"
        legend={[{ label: 'avg', color: 'var(--accent)' }, { label: 'p95', color: 'var(--warn)' }]}
        build={(s) => ({
          options: lineOptions([
            { key: 'avg', label: 'avg', color: CSS('--accent') },
            { key: 'p95', label: 'p95', color: CSS('--warn'), dash: [4, 4] },
          ], 's'),
          data: aligned(xs(s), col(s, 'avg'), col(s, 'p95')),
        })}
      />
    </div>
  );
}

function RfTab({ devEui, from }: { devEui: string; from: string }) {
  const rssi = useDeviceMetric(devEui, 'rssi', from);
  const snr = useDeviceMetric(devEui, 'snr', from);
  const gw = useDeviceMetric(devEui, 'gateway_count', from);
  return (
    <div className="charts two">
      <SeriesChart q={rssi} title="RSSI" legend={rfLegend('var(--accent)')} build={(s) => ({ options: bandOptions(CSS('--accent'), 'dBm'), data: aligned(xs(s), col(s, 'avg'), col(s, 'min'), col(s, 'max'), col(s, 'p95')) })} />
      <SeriesChart q={snr} title="SNR" legend={rfLegend('var(--ok)')} build={(s) => ({ options: bandOptions(CSS('--ok'), 'dB'), data: aligned(xs(s), col(s, 'avg'), col(s, 'min'), col(s, 'max'), col(s, 'p95')) })} />
      <SeriesChart
        q={gw}
        title="Gateways per uplink"
        legend={[{ label: 'avg', color: 'var(--sf8)' }, { label: 'min–max', color: 'var(--sf8)' }]}
        build={(s) => ({
          options: bandOptions(CSS('--sf8')),
          data: aligned(xs(s), col(s, 'avg'), col(s, 'min'), col(s, 'max'), constLine(s, NaN)),
        })}
      />
    </div>
  );
}

function NetworkTab({ devEui, from }: { devEui: string; from: string }) {
  const sf = useDeviceMetric(devEui, 'sf_distribution', from);
  const nb = useDeviceMetric(devEui, 'n_b_trans', from);
  const air = useDeviceMetric(devEui, 'airtime', from);
  return (
    <div className="charts two">
      <SeriesChart q={sf} title="Spreading factor distribution" legend={SF_DEFS.map((x) => ({ label: x.label, color: x.color }))} build={(s) => ({ options: stackOptions(SF_DEFS), data: stackData(s, SF_DEFS.map((x) => x.key)) })} />
      <SeriesChart
        q={nb}
        title="NbTrans average (thresholds 1.5 / 2.5)"
        legend={[{ label: 'NbTrans', color: 'var(--accent)' }, { label: '1.5', color: 'var(--warn)' }, { label: '2.5', color: 'var(--crit)' }]}
        build={(s) => ({
          options: lineOptions([
            { key: 'avg', label: 'NbTrans', color: CSS('--accent') },
            { key: 'warn', label: '1.5', color: CSS('--warn'), dash: [4, 4] },
            { key: 'crit', label: '2.5', color: CSS('--crit'), dash: [4, 4] },
          ]),
          data: aligned(xs(s), col(s, 'avg'), constLine(s, 1.5), constLine(s, 2.5)),
        })}
      />
      <SeriesChart q={air} title="Airtime per bucket (s)" build={(s) => ({ options: barOptions('airtime', CSS('--sf9'), 's'), data: toUplotData(s, ['total']) })} />
    </div>
  );
}

function DownlinksTab({ devEui, from }: { devEui: string; from: string }) {
  const dl = useDeviceMetric(devEui, 'downlink_success', from);
  return (
    <div className="charts two">
      <SeriesChart q={dl} title="Downlink lifecycle" legend={DL_DEFS.map((x) => ({ label: x.label, color: x.color }))} build={(s) => ({ options: stackOptions(DL_DEFS), data: stackData(s, DL_DEFS.map((x) => x.key)) })} />
      <SeriesChart
        q={dl}
        title="Downlink success rate"
        build={(s) => ({
          options: lineOptions([{ key: 'sr', label: 'success', color: CSS('--ok'), fill: `${CSS('--ok')}22` }], '%'),
          data: aligned(xs(s), s.map((p) => (typeof p.success_rate === 'number' ? p.success_rate * 100 : null))),
        })}
      />
    </div>
  );
}

function Tables({ devEui, from }: { devEui: string; from: string }) {
  const ups = useDeviceUplinks(devEui, from);
  const dls = useDeviceDownlinks(devEui, from);
  const joins = useDeviceJoins(devEui, from);
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <div className="card">
        <h2>Recent uplinks</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th><th className="num">f_cnt</th><th>SF</th><th className="num">Freq</th>
                <th className="num">RSSI</th><th className="num">SNR</th><th className="num">GW</th>
                <th className="num">Air s</th>
              </tr>
            </thead>
            <tbody>
              {(ups.data?.items ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="muted">{shortTime(u.timestamp)}</td>
                  <td className="num">{u.f_cnt}</td>
                  <td><SfBadge sf={u.sf} /></td>
                  <td className="num">{freqMhz(u.frequency)}</td>
                  <td className="num">{num(u.best_rssi)}</td>
                  <td className="num">{num(u.best_snr)}</td>
                  <td className="num">{u.gateway_count}</td>
                  <td className="num">{num(u.consumed_airtime_s, 3)}</td>
                </tr>
              ))}
              {(ups.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">No uplinks in range</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Recent downlinks</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>First seen</th><th>Lifecycle</th></tr></thead>
            <tbody>
              {(dls.data?.items ?? []).map((g) => (
                <tr key={g.correlation_id}>
                  <td className="muted">{shortTime(g.first_seen)}</td>
                  <td className="mono">{g.events.map((e) => e.event_type).join(' → ')}</td>
                </tr>
              ))}
              {(dls.data?.items.length ?? 0) === 0 ? <tr><td colSpan={2} className="empty">No downlinks in range</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Joins</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>DevAddr</th></tr></thead>
            <tbody>
              {(joins.data?.items ?? []).map((j) => (
                <tr key={j.id}><td className="muted">{shortTime(j.timestamp)}</td><td className="mono">{j.dev_addr ?? '—'}</td></tr>
              ))}
              {(joins.data?.items.length ?? 0) === 0 ? <tr><td colSpan={2} className="empty">No joins in range</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
