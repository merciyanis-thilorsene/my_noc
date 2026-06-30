import { useMemo, useState } from 'react';
import { useDevices } from '../api';
import { TimeRange, Range } from '../components/ui';
import { ago, int } from '../lib/format';

type Format = 'json' | 'csv';

export default function Export() {
  const [range, setRange] = useState<Range>('7d');
  const [format, setFormat] = useState<Format>('json');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const q = useDevices('', 'name');
  const devices = q.data?.items ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return devices;
    return devices.filter((d) => (d.name?.toLowerCase().includes(s) ?? false)
      || d.dev_eui.toLowerCase().includes(s) || d.device_id.toLowerCase().includes(s));
  }, [devices, search]);

  const toggle = (eui: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eui)) next.delete(eui);
      else next.add(eui);
      return next;
    });
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.dev_eui));
  const selectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((d) => next.delete(d.dev_eui));
      else filtered.forEach((d) => next.add(d.dev_eui));
      return next;
    });
  };

  const euis = [...selected];
  const url = `${import.meta.env.BASE_URL}api/export?dev_euis=${euis.join(',')}&from=${range}&format=${format}`;

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Export uplinks</h1>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button type="button" className={format === 'json' ? 'active' : ''} onClick={() => setFormat('json')}>JSON</button>
          <button type="button" className={format === 'csv' ? 'active' : ''} onClick={() => setFormat('csv')}>CSV</button>
        </div>
        <TimeRange value={range} onChange={setRange} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" className="theme-toggle" onClick={selectAll}>
            {allFilteredSelected ? 'Clear all' : 'Select all'}
          </button>
          <span className="muted">{`${int(selected.size)} selected`}</span>
          <input
            className="search"
            placeholder="Filter devices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="spacer" style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 11 }}>
            {`${format.toUpperCase()} · ${range} · max 50k uplinks`}
          </span>
          <button
            type="button"
            className="seg"
            onClick={download}
            disabled={selected.size === 0}
            style={{
              padding: '7px 16px',
              background: selected.size === 0 ? 'var(--bg-2)' : 'var(--accent)',
              color: selected.size === 0 ? 'var(--text-2)' : '#0b0e14',
              border: '1px solid var(--border)',
              borderRadius: 7,
              fontWeight: 600,
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ⤓ Export {selected.size > 0 ? `(${int(selected.size)})` : ''}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={allFilteredSelected} onChange={selectAll} aria-label="select all" />
                </th>
                <th>Name</th>
                <th>DevEUI</th>
                <th>Device ID</th>
                <th className="num">Uplinks 24h</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.dev_eui} className="clickable" onClick={() => toggle(d.dev_eui)}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(d.dev_eui)}
                      onChange={() => toggle(d.dev_eui)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`select ${d.dev_eui}`}
                    />
                  </td>
                  <td>{d.name ?? d.device_id}</td>
                  <td className="mono">{d.dev_eui}</td>
                  <td className="mono muted">{d.device_id}</td>
                  <td className="num">{int(d.uplinks_24h)}</td>
                  <td className="muted">{ago(d.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.isLoading ? <div className="loading">Loading…</div> : null}
        {!q.isLoading && filtered.length === 0 ? <div className="empty">No devices.</div> : null}
      </div>
    </div>
  );
}
