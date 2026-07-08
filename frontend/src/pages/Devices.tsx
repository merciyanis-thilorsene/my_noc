import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeviceListItem, useDevices } from '../api';
import { AlertIcon, StatusDot, SfBadge, lossTone } from '../components/ui';
import { linkHealth, rssiTone, snrTone } from '../lib/link';
import {
  ago, int, num, pct,
} from '../lib/format';
import { L } from '../lib/i18n';

type SortDir = 'asc' | 'desc';
type Cmp = (a: DeviceListItem, b: DeviceListItem) => number;

/** Sortable columns. `text` uses locale compare; the rest sort numerically with nulls last. */
interface Column {
  key: string;
  label: string;
  className?: string;
  defaultDir: SortDir;
  accessor: (d: DeviceListItem) => number | string | null;
  text?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: L.dev.colName, defaultDir: 'asc', text: true, accessor: (d) => d.name ?? d.device_id },
  { key: 'dev_eui', label: 'DevEUI', defaultDir: 'asc', text: true, accessor: (d) => d.dev_eui },
  { key: 'last_seen', label: L.dev.colSeen, defaultDir: 'desc', accessor: (d) => d.last_seen_at },
  { key: 'uplinks', label: L.dev.colUplinks, className: 'num', defaultDir: 'desc', accessor: (d) => d.uplinks_24h },
  { key: 'loss', label: L.dev.colLoss, className: 'num', defaultDir: 'desc', accessor: (d) => d.packet_loss_pct_24h },
  { key: 'nbtrans', label: 'NbTrans', className: 'num', defaultDir: 'desc', accessor: (d) => d.n_b_trans_avg_24h },
  { key: 'rssi', label: 'RSSI', className: 'num', defaultDir: 'desc', accessor: (d) => d.avg_rssi_24h },
  { key: 'snr', label: 'SNR', className: 'num', defaultDir: 'desc', accessor: (d) => d.avg_snr_24h },
  { key: 'sf', label: 'SF', defaultDir: 'asc', accessor: (d) => d.current_sf },
  { key: 'batt', label: L.dev.colBatt, className: 'num', defaultDir: 'desc', accessor: (d) => d.battery_pct },
];

/** Builds a comparator that keeps nulls last regardless of direction. */
function comparator(col: Column, dir: SortDir): Cmp {
  const factor = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (col.text) return factor * String(av).localeCompare(String(bv));
    return factor * (Number(av) - Number(bv));
  };
}

export default function Devices() {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('last_seen');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const navigate = useNavigate();
  const q = useDevices(search, 'last_seen');

  const items = useMemo(() => {
    const rows = [...(q.data?.items ?? [])];
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (col) rows.sort(comparator(col, sortDir));
    return rows;
  }, [q.data?.items, sortKey, sortDir]);

  const sortBy = (col: Column) => {
    if (col.key === sortKey) setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col.key);
      setSortDir(col.defaultDir);
    }
  };

  const caret = (col: Column) => {
    if (col.key !== sortKey) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div>
      <div className="page-head">
        <h1>{L.dev.title}</h1>
        <div className="spacer" style={{ flex: 1 }} />
        <input
          className="search"
          placeholder={L.common.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`sortable ${col.className ?? ''} ${col.key === sortKey ? 'sorted' : ''}`}
                    onClick={() => sortBy(col)}
                    title={L.common.sortBy(col.label)}
                  >
                    {col.label}
                    <span className="muted">{caret(col)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const health = linkHealth(r.avg_rssi_24h, r.avg_snr_24h, r.current_sf);
                const rTone = rssiTone(r.avg_rssi_24h);
                const sTone = snrTone(r.avg_snr_24h, r.current_sf);
                return (
                  <tr key={r.dev_eui} className="clickable" onClick={() => navigate(`/devices/${r.dev_eui}`)}>
                    <td>
                      <StatusDot lastSeen={r.last_seen_at} />
                      {' '}
                      <AlertIcon health={health} />
                    </td>
                    <td>{r.name ?? r.device_id}</td>
                    <td className="mono">{r.dev_eui}</td>
                    <td className="muted">{ago(r.last_seen_at)}</td>
                    <td className="num">{int(r.uplinks_24h)}</td>
                    <td className={`num ${lossTone(r.packet_loss_pct_24h) ?? ''}`}>{pct(r.packet_loss_pct_24h)}</td>
                    <td className="num">{num(r.n_b_trans_avg_24h, 2)}</td>
                    <td className={`num ${rTone === 'ok' ? '' : rTone}`}>{num(r.avg_rssi_24h)}</td>
                    <td className={`num ${sTone === 'ok' ? '' : sTone}`}>{num(r.avg_snr_24h)}</td>
                    <td><SfBadge sf={r.current_sf} /></td>
                    <td className="num">{int(r.battery_pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {q.isLoading ? <div className="loading">{L.common.loading}</div> : null}
        {!q.isLoading && items.length === 0
          ? <div className="empty">{L.dev.empty}</div> : null}
      </div>
    </div>
  );
}
