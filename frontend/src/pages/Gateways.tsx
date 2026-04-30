import { useNavigate } from 'react-router-dom';
import { useGateways } from '../hooks/useGateways';
import { EmptyState } from '../components/EmptyState';
import { StatusDot } from '../components/StatusDot';

export default function Gateways() {
  const navigate = useNavigate();
  const { data, isLoading } = useGateways();
  const items = data?.items ?? [];

  const statusOf = (raw: unknown): 'operational' | 'down' | 'unknown' => {
    const s = typeof raw === 'string' ? raw.toUpperCase() : '';
    if (s === 'OPERATIONAL' || s === 'CONNECTED') return 'operational';
    if (s === 'UNREACHABLE' || s === 'DISCONNECTED' || s === 'OFFLINE') return 'down';
    return 'unknown';
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 lg:col-span-7 panel overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-noc-border">
          <div className="label m-0">Gateways ({items.length})</div>
        </div>
        {isLoading ? (
          <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No gateways yet"
            hint="Waiting for the first TTS/WMC poll cycle. Check TTS_BASE_URL, TTS_API_KEY, WMC_BASE_URL, WMC_LOGIN/PASSWORD in your .env."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-noc-text-dim text-xs uppercase">
              <tr>
                <th className="p-3">Status</th>
                <th>EUI</th>
                <th>CPU</th>
                <th>Temp</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr
                  key={g.gateway_eui}
                  className="border-t border-noc-border hover:bg-noc-hover cursor-pointer"
                  onClick={() => navigate(`/gateways/${g.gateway_eui}`)}
                >
                  <td className="p-3">
                    <StatusDot status={statusOf(g.connection_status)} />
                  </td>
                  <td className="mono">{g.gateway_eui}</td>
                  <td className="mono">{g.cpu_pct ?? '—'}</td>
                  <td className="mono">{g.temperature_c ?? '—'}</td>
                  <td className="mono">{g.last_kpi_at ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="col-span-12 lg:col-span-5 panel-padded">
        <div className="label mb-2">Detail</div>
        <div className="text-noc-text-dim text-sm">Select a gateway to see details.</div>
      </section>
    </div>
  );
}
