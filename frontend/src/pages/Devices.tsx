import { useNavigate } from 'react-router-dom';
import { useDevices } from '../hooks/useDevices';
import { EmptyState } from '../components/EmptyState';
import { StatusDot } from '../components/StatusDot';
import { LossBadge, QualityBadge } from '../components/QualityBadge';

export default function Devices() {
  const navigate = useNavigate();
  const { data, isLoading } = useDevices();
  const items = data?.items ?? [];

  const isActive = (lastSeen: unknown): boolean => {
    if (typeof lastSeen !== 'string') return false;
    const age = Date.now() - new Date(lastSeen).getTime();
    return Number.isFinite(age) && age < 60 * 60 * 1_000; // 1h
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-7 panel overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-noc-border">
          <div className="label m-0">Devices ({items.length})</div>
        </div>
        {isLoading ? (
          <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No devices yet"
            hint="Devices appear once the TTS poller has run (set TTS_APP_IDS) or once a TTS webhook hits /webhooks/tts."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-noc-text-dim text-xs uppercase">
              <tr>
                <th className="p-3">Active</th>
                <th>DevEUI</th>
                <th>Name</th>
                <th title="Composite of RSSI + SNR, 0–100">RF</th>
                <th title="Packet loss in the last hour (FCnt-gap based)">Loss 1h</th>
                <th>RSSI</th>
                <th>SNR</th>
                <th>SF</th>
                <th>FCnt↑</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const active = isActive(d.last_seen);
                const last = typeof d.last_seen === 'string'
                  ? new Date(d.last_seen).toLocaleTimeString()
                  : '—';
                return (
                  <tr
                    key={d.dev_eui}
                    className="border-t border-noc-border hover:bg-noc-hover cursor-pointer"
                    onClick={() => navigate(`/devices/${d.dev_eui}`)}
                  >
                    <td className="p-3">
                      <StatusDot status={active ? 'operational' : 'unknown'} />
                    </td>
                    <td className="mono">{d.dev_eui}</td>
                    <td className="truncate max-w-[14rem]">{String(d.name ?? d.device_id ?? '—')}</td>
                    <td><QualityBadge value={d.rf_quality} /></td>
                    <td><LossBadge value={d.loss_pct_1h} /></td>
                    <td className="mono">{d.last_rssi ?? '—'}</td>
                    <td className="mono">{d.last_snr ?? '—'}</td>
                    <td className="mono">{d.last_sf ?? '—'}</td>
                    <td className="mono">{d.last_f_cnt_up ?? '—'}</td>
                    <td className="mono">{last}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="col-span-12 lg:col-span-5 panel-padded">
        <div className="label mb-2">Detail</div>
        <div className="text-noc-text-dim text-sm">Select a device to see details.</div>
      </section>
    </div>
  );
}
