import { useOverview } from '../hooks/useOverview';
import { useHealth } from '../hooks/useHealth';
import { useTraffic } from '../hooks/useTraffic';
import { HealthRing } from '../components/HealthRing';
import { MetricBox } from '../components/MetricBox';
import { Bars } from '../components/charts/Bars';
import { SfBar } from '../components/SfBar';

const hourFmt = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const d = new Date(v);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
};

export default function Overview() {
  const { data, isLoading, isError } = useOverview();
  const health = useHealth();
  const deps = health.data?.dependencies;
  const traffic = useTraffic(24);

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="panel-padded flex items-center gap-4">
          <HealthRing value={data?.network_health_score ?? 0} label="Health" />
          <div>
            <div className="label">Network</div>
            <div className="mono text-lg">
              {isLoading ? '…' : isError ? 'unreachable' : 'monitoring'}
            </div>
          </div>
        </div>

        <MetricBox
          label="Gateways"
          value={data?.fleet.gateways.total ?? 0}
          unit="total"
          source="WMC"
        >
          <div className="text-xs flex gap-3">
            <span className="text-noc-accent">{data?.fleet.gateways.operational ?? 0} op</span>
            <span className="text-noc-critical">{data?.fleet.gateways.unreachable ?? 0} unr</span>
            <span className="text-noc-text-dim">{data?.fleet.gateways.unknown ?? 0} ?</span>
          </div>
        </MetricBox>

        <MetricBox
          label="Devices"
          value={data?.fleet.devices.total ?? 0}
          unit="total"
          source="TTS"
        >
          <div className="text-xs flex gap-3">
            <span className="text-noc-accent">{data?.fleet.devices.active ?? 0} active</span>
            <span className="text-noc-warning">{data?.fleet.devices.low_battery ?? 0} low bat</span>
            <span className="text-noc-critical">{data?.fleet.devices.silent ?? 0} silent</span>
          </div>
        </MetricBox>

        <MetricBox
          label="Uplinks / min"
          value={data?.traffic.uplinks_last_minute ?? 0}
          source="TTS"
        />
      </section>

      <section className="panel-padded">
        <div className="flex items-center justify-between mb-3">
          <div className="label m-0">Uplinks · last 24h</div>
          <div className="text-xs text-noc-text-dim mono">
            {(traffic.data?.points.reduce((a, p) => a + p.uplinks, 0) ?? 0).toLocaleString()} total
          </div>
        </div>
        {traffic.isLoading ? (
          <div className="text-noc-text-dim text-sm">Loading…</div>
        ) : !traffic.data || traffic.data.points.length === 0 ? (
          <div className="text-noc-text-dim text-sm">No uplinks in the last 24h.</div>
        ) : (
          <Bars
            data={traffic.data.points}
            xKey="bucket"
            yKey="uplinks"
            color="#00e699"
            formatX={hourFmt}
          />
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="panel-padded flex items-center gap-4">
          <HealthRing value={data?.rf.health_score ?? 0} label="RF" />
          <div className="min-w-0">
            <div className="label">Radio health</div>
            <div className="text-xs text-noc-text-dim mono mt-1">
              {data?.rf.samples
                ? `${data.rf.samples} uplinks · last 1h`
                : 'no uplinks in last hour'}
            </div>
            <div className="text-xs mt-2 flex gap-3">
              <span className="text-noc-text-dim">
                RSSI <span className="mono text-noc-text">{data?.rf.rssi_avg?.toFixed(1) ?? '—'} dBm</span>
              </span>
              <span className="text-noc-text-dim">
                SNR <span className="mono text-noc-text">{data?.rf.snr_avg?.toFixed(1) ?? '—'} dB</span>
              </span>
            </div>
          </div>
        </div>

        <div className="panel-padded md:col-span-2 grid gap-3">
          <div className="flex items-center justify-between">
            <div className="label m-0">Spreading factor · last 1h</div>
            <div className="text-xs text-noc-text-dim mono">
              higher SF = more sensitive but slower / more airtime
            </div>
          </div>
          <SfBar slices={data?.sf_distribution ?? []} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-padded">
          <div className="label mb-3">Alerts</div>
          {!data || data.alerts.total === 0 ? (
            <div className="text-noc-accent mono">All systems operational.</div>
          ) : (
            <div className="flex gap-6">
              <div>
                <span className="text-noc-critical mono text-2xl">
                  {data.alerts.by_severity.critical}
                </span>
                <div className="text-xs text-noc-text-dim">critical</div>
              </div>
              <div>
                <span className="text-noc-warning mono text-2xl">
                  {data.alerts.by_severity.warning}
                </span>
                <div className="text-xs text-noc-text-dim">warning</div>
              </div>
              <div>
                <span className="text-noc-info mono text-2xl">
                  {data.alerts.by_severity.info}
                </span>
                <div className="text-xs text-noc-text-dim">info</div>
              </div>
            </div>
          )}
        </div>

        <div className="panel-padded grid gap-2">
          <div className="label">Integrations</div>
          <div className="flex gap-6 text-sm flex-wrap">
            <span>
              <span className="text-noc-text-dim">TTS </span>
              <span className={`mono ${deps?.tts === 'configured' ? 'text-noc-accent' : 'text-noc-text-dim'}`}>
                {deps?.tts ?? '…'}
              </span>
            </span>
            <span>
              <span className="text-noc-text-dim">WMC </span>
              <span className={`mono ${deps?.wmc === 'configured' ? 'text-noc-accent' : 'text-noc-text-dim'}`}>
                {deps?.wmc ?? '…'}
              </span>
            </span>
            <span>
              <span className="text-noc-text-dim">ML </span>
              <span className="mono text-noc-text-dim">{deps?.ml_service ?? '…'}</span>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
