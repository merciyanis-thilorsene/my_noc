import { useMemo, useState } from 'react';
import { useDevices, sendBusylightDownlinkMany, DownlinkManyResult } from '../api';
import { ago } from '../lib/format';
import BusylightControls, { busylightPayload, LightMode } from '../components/BusylightControls';
import { L } from '../lib/i18n';

export default function Control() {
  const [hex, setHex] = useState('#00e000');
  const [mode, setMode] = useState<LightMode>('solid');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<DownlinkManyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useDevices('', 'name');
  const devices = q.data?.items ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return devices;
    return devices.filter((d) => (d.name?.toLowerCase().includes(s) ?? false)
      || d.dev_eui.toLowerCase().includes(s) || d.device_id.toLowerCase().includes(s));
  }, [devices, search]);

  const toggle = (eui: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(eui)) next.delete(eui);
    else next.add(eui);
    return next;
  });
  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.dev_eui));
  const selectAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allSelected) filtered.forEach((d) => next.delete(d.dev_eui));
    else filtered.forEach((d) => next.add(d.dev_eui));
    return next;
  });

  const send = () => {
    setSending(true);
    setResult(null);
    setError(null);
    sendBusylightDownlinkMany([...selected], busylightPayload(hex, mode))
      .then((r) => setResult(r))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSending(false));
  };

  const failed = new Map((result?.results ?? []).filter((r) => !r.ok).map((r) => [r.dev_eui, r.message]));

  return (
    <div>
      <div className="page-head">
        <h1>{L.ctl.title}</h1>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>{L.ctl.cardTitle}</h2>
        <div style={{ marginBottom: 16 }}>
          <BusylightControls hex={hex} mode={mode} onHex={setHex} onMode={setMode} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn small"
            onClick={send}
            disabled={sending || selected.size === 0}
            style={{
              background: selected.size === 0 ? 'var(--bg-2)' : 'var(--accent)',
              color: selected.size === 0 ? 'var(--text-2)' : '#0b0e14',
              fontWeight: 600,
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? L.ctl.sending : L.ctl.send(selected.size)}
          </button>
          {result ? (
            <span className={result.failed === 0 ? 'ok' : 'warn'}>
              {L.ctl.sent(result.sent)}
              {result.failed > 0 ? L.ctl.failed(result.failed) : ''}
              {' '}
              {L.ctl.applies}
            </span>
          ) : null}
          {error ? <span className="crit">{error}</span> : null}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          <button type="button" className="btn small" onClick={selectAll}>
            {allSelected ? L.common.clearAll : L.common.selectAll}
          </button>
          <span className="muted">{L.common.selected(selected.size)}</span>
          <input className="search" placeholder={L.common.filterDevices} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={allSelected} onChange={selectAll} aria-label="select all" />
                </th>
                <th>{L.common.name}</th>
                <th>DevEUI</th>
                <th>{L.common.seen}</th>
                <th>{L.ctl.colResult}</th>
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
                  <td className="muted">{ago(d.last_seen_at)}</td>
                  <td>
                    {result && selected.has(d.dev_eui)
                      ? (failed.has(d.dev_eui)
                        ? <span className="crit" title={failed.get(d.dev_eui) ?? ''}>{L.ctl.failedOne}</span>
                        : <span className="ok">{L.ctl.sentOne}</span>)
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.isLoading ? <div className="loading">{L.common.loading}</div> : null}
        {!q.isLoading && filtered.length === 0 ? <div className="empty">{L.dev.empty}</div> : null}
      </div>
    </div>
  );
}
