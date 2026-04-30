import { useNavigate, useParams } from 'react-router-dom';
import { useGateway } from '../hooks/useGateways';
import { useGatewayMetrics } from '../hooks/useGatewayMetrics';
import { MetricBox } from '../components/MetricBox';
import { StatusDot } from '../components/StatusDot';
import { TimeSeries } from '../components/charts/TimeSeries';

const timeFmt = (v: unknown): string =>
  typeof v === 'string' ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function statusOf(raw: unknown): 'operational' | 'down' | 'unknown' {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (s === 'OPERATIONAL' || s === 'CONNECTED') return 'operational';
  if (s === 'UNREACHABLE' || s === 'DISCONNECTED' || s === 'OFFLINE') return 'down';
  return 'unknown';
}

function uptime(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export default function GatewayDetail() {
  const { eui } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGateway(eui);
  const metrics = useGatewayMetrics(eui);
  const g = data?.gateway;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <button className="btn" onClick={() => navigate('/gateways')}>← Back</button>
        <h1 className="mono text-lg">{eui}</h1>
        {g && <StatusDot status={statusOf(g.connection_status)} label={String(g.connection_status ?? 'unknown')} />}
      </div>

      {isLoading ? (
        <div className="panel-padded text-noc-text-dim">Loading…</div>
      ) : isError ? (
        <div className="panel-padded text-noc-critical">Gateway not found.</div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricBox label="CPU"         value={g?.cpu_pct ?? '—'}         unit="%"  source="WMC" />
            <MetricBox label="RAM"         value={g?.ram_pct ?? '—'}         unit="%"  source="WMC" />
            <MetricBox label="Temperature" value={g?.temperature_c ?? '—'}   unit="°C" source="WMC" />
            <MetricBox label="Uptime"      value={uptime(g?.uptime_s)}        source="WMC" />
          </section>

          <section className="panel-padded grid gap-2">
            <div className="label">Identity</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-noc-text-dim">Name </span><span className="mono">{String(g?.name ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Description </span><span>{String(g?.description ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Frequency plan </span><span className="mono">{String(g?.frequency_plan_id ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Firmware </span><span className="mono">{String(g?.firmware_version ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Backhaul </span><span className="mono">{String(g?.backhaul_type ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Customer ID </span><span className="mono">{String(g?.customer_id ?? '—')}</span></div>
              <div><span className="text-noc-text-dim">Last KPI </span><span className="mono">{timeFmt(g?.last_kpi_at)}</span></div>
              <div className="flex gap-2 items-center">
                {g?.tts_source ? <span className="text-noc-tts text-[10px] mono">TTS</span> : null}
                {g?.wmc_source ? <span className="text-noc-wmc text-[10px] mono">WMC</span> : null}
              </div>
            </div>
          </section>

          <section className="panel-padded">
            <div className="flex items-center justify-between mb-3">
              <div className="label m-0">CPU / RAM / Temperature · 24h</div>
              <div className="text-xs text-noc-text-dim mono">{metrics.data?.points.length ?? 0} buckets</div>
            </div>
            {metrics.isLoading ? (
              <div className="text-noc-text-dim text-sm">Loading…</div>
            ) : !metrics.data || metrics.data.points.length === 0 ? (
              <div className="text-noc-text-dim text-sm">No KPI history yet — WMC has to collect a few cycles first.</div>
            ) : (
              <TimeSeries
                data={metrics.data.points}
                xKey="bucket"
                formatX={timeFmt}
                series={[
                  { key: 'cpu_pct_avg', color: '#2888ff', label: 'CPU %', yAxisId: 'left' },
                  { key: 'ram_pct_avg', color: '#ffaa22', label: 'RAM %', yAxisId: 'left' },
                  { key: 'temperature_c_avg', color: '#ff3050', label: 'Temp °C', yAxisId: 'right' },
                ]}
                height={280}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
