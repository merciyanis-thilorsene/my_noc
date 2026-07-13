import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useDevice, useDeviceDownlinks, useDeviceEvents, useDeviceGateways, useDeviceJoins,
  useDeviceMetric, useDeviceUplinks, sendBusylightDownlink, SeriesPoint,
} from '../api';
import {
  Kpi, TimeRange, Range, SfBadge, StatusBadge, lossTone,
} from '../components/ui';
import { linkHealth } from '../lib/link';
import { rssiColor, statusMeta } from '../lib/gateways';
import BusylightControls, { busylightPayload, LightMode } from '../components/BusylightControls';
import SeriesChart from '../components/SeriesChart';
import {
  aligned, barOptions, bandOptions, eventData, eventTimelineOptions, lineOptions, lossData, lossOptions,
  stackData, stackOptions, toUplotData,
} from '../lib/uplot';
import {
  ago, CSS, freqMhz, int, num, pct, rate, shortTime,
} from '../lib/format';
import { L } from '../lib/i18n';

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

const TABS = [
  { id: 'traffic', label: L.dd.tabTraffic },
  { id: 'rf', label: L.dd.tabRf },
  { id: 'network', label: L.dd.tabNetwork },
  { id: 'downlinks', label: L.dd.tabDownlinks },
  { id: 'control', label: L.dd.tabControl },
] as const;
type Tab = typeof TABS[number]['id'];

export default function DeviceDetail() {
  const { devEui = '' } = useParams();
  const [range, setRange] = useState<Range>('24h');
  const [tab, setTab] = useState<Tab>('traffic');

  const dev = useDevice(devEui);
  const m = dev.data?.metrics[KPI_WINDOW[range]] ?? {};
  const device = dev.data?.device;
  // Link health from the 24h window's RF averages + current SF (LoRa demod-margin based).
  const m24 = dev.data?.metrics['24h'] ?? {};
  const health = linkHealth(m24.avg_rssi ?? null, m24.avg_snr ?? null, dev.data?.current_sf ?? null);

  if (dev.isLoading) return <div className="loading">{L.dd.loading}</div>;
  if (dev.error || !device) return <div className="error">{L.dd.notFound}</div>;

  return (
    <div>
      <div className="page-head">
        <Link to="/devices" className="muted">{L.dd.back}</Link>
        <h1 style={{ marginLeft: 8 }}>{device.name ?? device.device_id}</h1>
        <StatusBadge lastSeen={device.last_seen_at} />
        {health.level !== 'ok' ? (
          <span className={`badge ${health.level}`} title={health.reasons.join(' · ')}>
            {health.level === 'crit' ? L.dd.linkCrit : L.dd.linkWarn}
          </span>
        ) : null}
        <div className="spacer" style={{ flex: 1 }} />
        <a
          className="pill"
          href={`${import.meta.env.BASE_URL}api/devices/${devEui}/export?format=json&from=${range}`}
          download
          title={L.dd.jsonTitle}
        >
          ⤓ JSON
        </a>
        <a
          className="pill"
          href={`${import.meta.env.BASE_URL}api/devices/${devEui}/export?format=csv&from=${range}`}
          download
          title={L.dd.csvTitle}
        >
          ⤓ CSV
        </a>
        <TimeRange value={range} onChange={setRange} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12 }}>
          <Meta label="DevEUI" value={device.dev_eui} mono />
          <Meta label={L.dd.mDeviceId} value={device.device_id} mono />
          <Meta label="Application" value={device.application_id} mono />
          <Meta label="LoRaWAN" value={device.lorawan_version ?? '—'} />
          <Meta label={L.dd.mFirstSeen} value={ago(device.first_seen_at)} />
          <Meta label={L.dd.mLastSeen} value={ago(device.last_seen_at)} />
        </div>
      </div>

      <div className="kpis">
        <Kpi label={L.dd.kUplinks(range)} value={int(m.uplinks)} />
        <Kpi label={L.dd.kLoss} value={pct(m.packet_loss_pct)} tone={lossTone(m.packet_loss_pct ?? null)} />
        <Kpi label={L.dd.kNbTrans} value={num(m.n_b_trans_avg, 2)} />
        <Kpi label={L.dd.kRssi} value={num(m.avg_rssi)} sub="dBm" />
        <Kpi label={L.dd.kSnr} value={num(m.avg_snr)} sub="dB" />
        <Kpi label={L.dd.kGw} value={num(m.avg_gateway_count)} />
        <Kpi label={L.dd.kDlSuccess} value={rate(m.downlink_success_rate)} sub={L.dd.kDlTotal(int(m.downlinks_total))} />
        <Kpi label={L.dd.kAirtime} value={num(m.total_airtime_s, 1)} sub="s" />
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'traffic' ? <TrafficTab devEui={devEui} from={range} /> : null}
      {tab === 'rf' ? <RfTab devEui={devEui} from={range} /> : null}
      {tab === 'network' ? <NetworkTab devEui={devEui} from={range} /> : null}
      {tab === 'downlinks' ? <DownlinksTab devEui={devEui} from={range} /> : null}
      {tab === 'control' ? <ControlTab devEui={devEui} /> : null}

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
  const events = useDeviceEvents(devEui, from);
  const count = useDeviceMetric(devEui, 'uplink_count', from);
  const loss = useDeviceMetric(devEui, 'packet_loss', from);
  const inter = useDeviceMetric(devEui, 'inter_arrival', from);
  return (
    <>
      <SeriesChart
        q={events}
        title={L.dd.cTimeline}
        height={90}
        build={(s) => ({ options: eventTimelineOptions(), data: eventData(s) })}
      />
      <div className="charts two" style={{ marginTop: 12 }}>
        <SeriesChart q={count} title={L.dd.cUplinks} build={(s) => ({ options: barOptions('uplinks', CSS('--accent')), data: toUplotData(s, ['count']) })} />
      <SeriesChart
        q={loss}
        title={L.dd.cLoss}
        legend={[{ label: L.dd.cLossSeries, color: 'var(--crit)' }]}
        build={(s) => ({ options: lossOptions(), data: lossData(s) })}
      />
      <SeriesChart
        q={inter}
        title={L.dd.cInterArrival}
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
    </>
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
        title={L.dd.cGwPerUplink}
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
      <SeriesChart q={sf} title={L.dd.cSfDist} legend={SF_DEFS.map((x) => ({ label: x.label, color: x.color }))} build={(s) => ({ options: stackOptions(SF_DEFS), data: stackData(s, SF_DEFS.map((x) => x.key)) })} />
      <SeriesChart
        q={nb}
        title={L.dd.cNbTrans}
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
      <SeriesChart q={air} title={L.dd.cAirtime} build={(s) => ({ options: barOptions('airtime', CSS('--sf9'), 's'), data: toUplotData(s, ['total']) })} />
    </div>
  );
}

function DownlinksTab({ devEui, from }: { devEui: string; from: string }) {
  const dl = useDeviceMetric(devEui, 'downlink_success', from);
  return (
    <div className="charts two">
      <SeriesChart q={dl} title={L.dd.cDlLifecycle} legend={DL_DEFS.map((x) => ({ label: x.label, color: x.color }))} build={(s) => ({ options: stackOptions(DL_DEFS), data: stackData(s, DL_DEFS.map((x) => x.key)) })} />
      <SeriesChart
        q={dl}
        title={L.dd.cDlRate}
        build={(s) => ({
          options: lineOptions([{ key: 'sr', label: L.dd.cDlRateSeries, color: CSS('--ok'), fill: `${CSS('--ok')}22` }], '%'),
          data: aligned(xs(s), s.map((p) => (typeof p.success_rate === 'number' ? p.success_rate * 100 : null))),
        })}
      />
    </div>
  );
}

/** Kuando Busylight downlink control for a single device. Multi-device lives on /control. */
function ControlTab({ devEui }: { devEui: string }) {
  const [hex, setHex] = useState('#00e000');
  const [mode, setMode] = useState<LightMode>('solid');
  const [status, setStatus] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });

  const send = () => {
    setStatus({ kind: 'sending' });
    sendBusylightDownlink(devEui, busylightPayload(hex, mode))
      .then(() => setStatus({ kind: 'ok' }))
      .catch((e: unknown) => setStatus({ kind: 'err', msg: e instanceof Error ? e.message : String(e) }));
  };

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2>{L.dd.ctlTitle}</h2>
      <div style={{ marginBottom: 16 }}>
        <BusylightControls hex={hex} mode={mode} onHex={setHex} onMode={setMode} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          type="button"
          className="btn small"
          onClick={send}
          disabled={status.kind === 'sending'}
          style={{ background: 'var(--accent)', color: '#0b0e14', fontWeight: 600 }}
        >
          {status.kind === 'sending' ? L.dd.ctlSending : L.dd.ctlSend}
        </button>
        {status.kind === 'ok' ? <span className="ok">{L.dd.ctlQueued}</span> : null}
        {status.kind === 'err' ? <span className="crit">{status.msg}</span> : null}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        {L.dd.ctlHint1}
        {L.dd.ctlHint2}
      </div>
    </div>
  );
}

function GatewaysHeard({ devEui, from }: { devEui: string; from: string }) {
  const gws = useDeviceGateways(devEui, from);
  const items = gws.data?.items ?? [];
  return (
    <div className="card">
      <h2>
        {L.dd.tGateways}
        {items.length > 0 ? <span className="muted">{` · ${L.dd.tHeardVia(items.length)}`}</span> : null}
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{L.gw.colGateway}</th>
              <th className="num">{L.gw.colUplinks}</th>
              <th className="num">RSSI</th>
              <th className="num">SNR</th>
              <th>{L.gw.colHeard}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => {
              const meta = statusMeta({ status: g.status, stale: false });
              return (
                <tr key={g.gw_eui} className="clickable">
                  <td>
                    <Link to={`/gateways?gw=${g.gw_eui}`} style={{ color: 'inherit' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span className="icon" style={{ fontSize: 15, color: meta.color }}>cell_tower</span>
                        <span>
                          <span style={{ fontWeight: 600 }}>{g.name ?? g.site_name ?? g.gw_eui}</span>
                          {g.name !== null || g.site_name !== null
                            ? <span className="mono muted" style={{ display: 'block', fontSize: 10 }}>{g.gw_eui}</span>
                            : null}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="num">{int(g.uplinks)}</td>
                  <td className="num" style={{ color: rssiColor(g.avg_rssi) }}>{num(g.avg_rssi, 0)}</td>
                  <td className="num">{num(g.avg_snr)}</td>
                  <td className="muted">{ago(g.last_heard_at)}</td>
                </tr>
              );
            })}
            {items.length === 0
              ? <tr><td colSpan={5} className="empty">{L.dd.tGatewaysEmpty}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {items.length === 1 ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, marginTop: 10,
          color: 'var(--berry-text)', fontSize: 12, fontWeight: 600,
        }}
        >
          <span className="icon" style={{ fontSize: 15 }}>crisis_alert</span>
          {L.dd.tSinglePoint}
        </div>
      ) : null}
    </div>
  );
}

function Tables({ devEui, from }: { devEui: string; from: string }) {
  const ups = useDeviceUplinks(devEui, from);
  const dls = useDeviceDownlinks(devEui, from);
  const joins = useDeviceJoins(devEui, from);
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <GatewaysHeard devEui={devEui} from={from} />
      <div className="card">
        <h2>{L.dd.tUplinks}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{L.dd.tTime}</th><th className="num">f_cnt</th><th>SF</th><th className="num">Freq</th>
                <th className="num">RSSI</th><th className="num">SNR</th><th className="num">GW</th>
                <th className="num">{L.dd.tAir}</th>
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
              {(ups.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">{L.dd.tUplinksEmpty}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{L.dd.tDownlinks}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{L.dd.tFirstSeen}</th><th>{L.dd.tLifecycle}</th></tr></thead>
            <tbody>
              {(dls.data?.items ?? []).map((g) => (
                <tr key={g.correlation_id}>
                  <td className="muted">{shortTime(g.first_seen)}</td>
                  <td className="mono">{g.events.map((e) => e.event_type).join(' → ')}</td>
                </tr>
              ))}
              {(dls.data?.items.length ?? 0) === 0 ? <tr><td colSpan={2} className="empty">{L.dd.tDownlinksEmpty}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>{L.dd.tJoins}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{L.dd.tTime}</th><th>DevAddr</th></tr></thead>
            <tbody>
              {(joins.data?.items ?? []).map((j) => (
                <tr key={j.id}><td className="muted">{shortTime(j.timestamp)}</td><td className="mono">{j.dev_addr ?? '—'}</td></tr>
              ))}
              {(joins.data?.items.length ?? 0) === 0 ? <tr><td colSpan={2} className="empty">{L.dd.tJoinsEmpty}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
