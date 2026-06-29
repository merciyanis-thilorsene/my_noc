import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDevices } from '../api';
import { StatusDot, SfBadge, lossTone } from '../components/ui';
import {
  ago, int, num, pct,
} from '../lib/format';

const SORTS = [
  { value: 'last_seen', label: 'Last seen' },
  { value: 'loss_rate', label: 'Packet loss' },
  { value: 'rssi', label: 'RSSI' },
  { value: 'name', label: 'Name' },
];

export default function Devices() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('last_seen');
  const navigate = useNavigate();
  const q = useDevices(search, sort);
  const items = q.data?.items ?? [];

  return (
    <div>
      <div className="page-head">
        <h1>Devices</h1>
        <div className="spacer" style={{ flex: 1 }} />
        <input
          className="search"
          placeholder="Search name, DevEUI, device id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{`Sort: ${s.label}`}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>DevEUI</th>
                <th>Last seen</th>
                <th className="num">Uplinks 24h</th>
                <th className="num">Loss %</th>
                <th className="num">NbTrans</th>
                <th className="num">RSSI</th>
                <th className="num">SNR</th>
                <th>SF</th>
                <th className="num">Batt %</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.dev_eui} className="clickable" onClick={() => navigate(`/devices/${r.dev_eui}`)}>
                  <td><StatusDot lastSeen={r.last_seen_at} /></td>
                  <td>{r.name ?? r.device_id}</td>
                  <td className="mono">{r.dev_eui}</td>
                  <td className="muted">{ago(r.last_seen_at)}</td>
                  <td className="num">{int(r.uplinks_24h)}</td>
                  <td className={`num ${lossTone(r.packet_loss_pct_24h) ?? ''}`}>{pct(r.packet_loss_pct_24h)}</td>
                  <td className="num">{num(r.n_b_trans_avg_24h, 2)}</td>
                  <td className="num">{num(r.avg_rssi_24h)}</td>
                  <td className="num">{num(r.avg_snr_24h)}</td>
                  <td><SfBadge sf={r.current_sf} /></td>
                  <td className="num">{int(r.battery_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.isLoading ? <div className="loading">Loading…</div> : null}
        {!q.isLoading && items.length === 0
          ? <div className="empty">No devices match. They appear here once they transmit.</div> : null}
      </div>
    </div>
  );
}
