import { useNavigate, useParams } from 'react-router-dom';
import { useDevice } from '../hooks/useDevices';
import { useDeviceMetrics, useDeviceUplinks } from '../hooks/useDeviceData';
import { useDevicePacketLoss } from '../hooks/useDevicePacketLoss';
import { MetricBox } from '../components/MetricBox';
import { StatusDot } from '../components/StatusDot';
import { TimeSeries } from '../components/charts/TimeSeries';
import { LossBadge } from '../components/QualityBadge';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const timeFmt = (v: unknown): string =>
  typeof v === 'string' ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const fullFmt = (v: unknown): string =>
  typeof v === 'string' ? new Date(v).toLocaleString() : '—';

function isActive(lastSeen: unknown): boolean {
  if (typeof lastSeen !== 'string') return false;
  const age = Date.now() - new Date(lastSeen).getTime();
  return Number.isFinite(age) && age < 60 * 60 * 1_000;
}

export default function DeviceDetail() {
  const { eui } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useDevice(eui);
  const metrics = useDeviceMetrics(eui, 24);
  const uplinks = useDeviceUplinks(eui, 50);
  const loss = useDevicePacketLoss(eui, 24);

  // Recharts needs a single stacked field per bar. Compose lost = expected − received.
  const lossPoints = (loss.data?.points ?? []).map((p) => ({
    bucket: p.bucket,
    received: p.received,
    lost: Math.max(0, p.expected - p.received),
  }));

  const device = (data as { device?: Record<string, unknown> } | undefined)?.device ?? {};
  const last   = (data as { last_uplink?: Record<string, unknown> } | undefined)?.last_uplink ?? null;

  // Tiny helper: unknown → renderable (strings or numbers pass through, others fall back to '—')
  const v = (x: unknown): string | number =>
    typeof x === 'string' || typeof x === 'number' ? x : '—';

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <button className="btn" onClick={() => navigate('/devices')}>← Back</button>
        <h1 className="mono text-lg">{eui}</h1>
        <StatusDot
          status={isActive(last?.timestamp) ? 'operational' : 'unknown'}
          label={isActive(last?.timestamp) ? 'active' : 'inactive'}
        />
      </div>

      {isLoading ? (
        <div className="panel-padded text-noc-text-dim">Loading…</div>
      ) : isError ? (
        <div className="panel-padded text-noc-critical">Device not found.</div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricBox label="Last RSSI"    value={v(last?.best_rssi)}     unit="dBm" source="TTS" />
            <MetricBox label="Last SNR"     value={v(last?.best_snr)}      unit="dB"  source="TTS" />
            <MetricBox label="Spreading factor" value={v(last?.sf)}        source="TTS" />
            <MetricBox label="Gateways"     value={v(last?.gateway_count)} source="TTS" />
          </section>

          <section className="panel-padded grid gap-2">
            <div className="label">Identity</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-noc-text-dim">Name </span><span className="mono">{String(device.name ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Device ID </span><span className="mono">{String(device.device_id ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">App </span><span className="mono">{String(device.app_id ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Join EUI </span><span className="mono">{String(device.join_eui ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Last seen </span><span className="mono">{fullFmt(last?.timestamp)}</span></div>
              <div><span className="text-noc-text-dim">FCnt↑ </span><span className="mono">{String(last?.f_cnt_up ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">FPort </span><span className="mono">{String(last?.f_port ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Airtime </span><span className="mono">{last?.consumed_airtime_s ? `${(Number(last.consumed_airtime_s) * 1000).toFixed(1)} ms` : '—'}</span></div>
            </div>
          </section>

          <section className="panel-padded">
            <div className="flex items-center justify-between mb-3">
              <div className="label m-0">RSSI / SNR · 24h</div>
              <div className="text-xs text-noc-text-dim mono">
                bucket: {metrics.data?.bucket ?? '—'} · {metrics.data?.points.length ?? 0} pts
              </div>
            </div>
            {metrics.isLoading ? (
              <div className="text-noc-text-dim text-sm">Loading…</div>
            ) : !metrics.data || metrics.data.points.length === 0 ? (
              <div className="text-noc-text-dim text-sm">No uplinks in the last 24h.</div>
            ) : (
              <TimeSeries
                data={metrics.data.points}
                xKey="bucket"
                formatX={timeFmt}
                series={[
                  { key: 'rssi_avg', color: '#6c3dff', label: 'RSSI (dBm)', yAxisId: 'left'  },
                  { key: 'snr_avg',  color: '#00e699', label: 'SNR (dB)',   yAxisId: 'right' },
                ]}
                height={240}
              />
            )}
          </section>

          <section className="panel-padded">
            <div className="flex items-center justify-between mb-3">
              <div className="label m-0">Packet loss · 24h (FCnt-gap)</div>
              <div className="text-xs mono">
                {loss.data?.totals.expected
                  ? <>{loss.data.totals.received}/{loss.data.totals.expected} received · <LossBadge value={loss.data.totals.loss_pct} /></>
                  : <span className="text-noc-text-dim">no data</span>}
              </div>
            </div>
            {loss.isLoading ? (
              <div className="text-noc-text-dim text-sm">Loading…</div>
            ) : lossPoints.length === 0 || lossPoints.every(p => p.received === 0 && p.lost === 0) ? (
              <div className="text-noc-text-dim text-sm">No uplinks in the last 24h — nothing to compute.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={lossPoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#15202e" strokeDasharray="2 4" />
                  <XAxis
                    dataKey="bucket"
                    stroke="#5a6e80"
                    fontSize={11}
                    minTickGap={30}
                    tickFormatter={timeFmt}
                  />
                  <YAxis stroke="#5a6e80" fontSize={11} width={40} />
                  <Tooltip
                    contentStyle={{ background: '#0c1118', border: '1px solid #15202e', fontSize: 12 }}
                    labelStyle={{ color: '#dce4ec' }}
                    labelFormatter={(v) => timeFmt(v as unknown)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#dce4ec' }} />
                  <Bar dataKey="received" stackId="s" fill="#00e699" isAnimationActive={false} name="received" />
                  <Bar dataKey="lost"     stackId="s" fill="#ff3050" isAnimationActive={false} name="lost" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="p-3 border-b border-noc-border label m-0">
              Recent uplinks ({uplinks.data?.items.length ?? 0})
            </div>
            {uplinks.isLoading ? (
              <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
            ) : !uplinks.data?.items.length ? (
              <div className="p-6 text-noc-text-dim text-sm">No uplinks yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-noc-text-dim text-xs uppercase">
                    <tr>
                      <th className="p-3">Time</th>
                      <th>FCnt</th>
                      <th>FPort</th>
                      <th>SF</th>
                      <th>RSSI</th>
                      <th>SNR</th>
                      <th>GWs</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uplinks.data.items.map((u, i) => (
                      <tr key={u.id ?? i} className="border-t border-noc-border">
                        <td className="p-3 mono text-xs">{fullFmt(u.timestamp)}</td>
                        <td className="mono">{u.f_cnt_up ?? '—'}</td>
                        <td className="mono">{u.f_port ?? '—'}</td>
                        <td className="mono">{u.sf ?? '—'}</td>
                        <td className="mono">{u.best_rssi ?? '—'}</td>
                        <td className="mono">{u.best_snr ?? '—'}</td>
                        <td className="mono">{u.gateway_count ?? '—'}</td>
                        <td className="mono text-xs text-noc-text-dim truncate max-w-[22rem]">
                          {u.decoded_payload ? JSON.stringify(u.decoded_payload) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
