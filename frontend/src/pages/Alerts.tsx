import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import type { Alert } from '../api/types';
import { SourceBadge } from '../components/SourceBadge';
import { EmptyState } from '../components/EmptyState';

type Severity = 'info' | 'warning' | 'critical';
type Status = 'all' | 'active' | 'cleared';

export default function Alerts() {
  const [status, setStatus] = useState<Status>('all');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const { data, isLoading } = useAlerts(status);
  const items = useMemo(
    () => (data?.items ?? []).filter((a) => severity === 'all' || a.severity === severity),
    [data, severity],
  );

  const active = items.filter((a) => !a.cleared_at);
  const past   = items.filter((a) =>  a.cleared_at);

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'active', 'cleared'] as Status[]).map((s) => (
          <button
            key={s}
            className={`btn ${status === s ? 'bg-noc-hover text-noc-text border-noc-info' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
        <div className="w-4" />
        {(['all', 'critical', 'warning', 'info'] as const).map((s) => (
          <button
            key={s}
            className={`btn ${severity === s ? 'bg-noc-hover text-noc-text border-noc-info' : ''}`}
            onClick={() => setSeverity(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-noc-border label m-0">
          Active ({active.length})
        </div>
        {isLoading ? (
          <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
        ) : active.length === 0 ? (
          <EmptyState title="No active alerts" hint="Nothing firing right now." />
        ) : (
          <AlertList items={active} />
        )}
      </section>

      {past.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="p-3 border-b border-noc-border label m-0">
            History ({past.length})
          </div>
          <AlertList items={past} />
        </section>
      )}
    </div>
  );
}

function AlertList({ items }: { items: Alert[] }) {
  return (
    <ul className="divide-y divide-noc-border">
      {items.map((a) => {
        const link = a.entity_type === 'gateway' ? `/gateways/${a.entity_id}`
                  : a.entity_type === 'device'  ? `/devices/${a.entity_id}`
                  : null;
        return (
          <li key={a.id} className="p-3 flex items-center gap-3">
            <span
              className={`w-1.5 h-10 rounded ${
                a.severity === 'critical' ? 'bg-noc-critical'
                : a.severity === 'warning' ? 'bg-noc-warning'
                : 'bg-noc-info'
              }`}
            />
            <SourceBadge source={a.source} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{a.message}</div>
              <div className="text-xs text-noc-text-dim mono">
                {link ? (
                  <Link to={link} className="hover:text-noc-text">
                    {a.entity_type}:{a.entity_id}
                  </Link>
                ) : (
                  <span>{a.entity_type}:{a.entity_id}</span>
                )}
                {' · '}raised {new Date(a.raised_at).toLocaleString()}
                {a.cleared_at
                  ? ` · cleared ${new Date(a.cleared_at).toLocaleString()}`
                  : ' · ongoing'}
                {' · '}<span className="opacity-70">{a.rule_name}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
