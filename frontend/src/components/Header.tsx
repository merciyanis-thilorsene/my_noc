import { NavLink } from 'react-router-dom';
import { useHealth } from '../hooks/useHealth';
import { useOverview } from '../hooks/useOverview';

const tabs = [
  { to: '/',         label: 'Overview', end: true },
  { to: '/gateways', label: 'Gateways' },
  { to: '/devices',  label: 'Devices'  },
  { to: '/lorawan',  label: 'LoRaWAN'  },
  { to: '/alerts',   label: 'Alerts'   },
  { to: '/settings', label: 'Settings' },
];

export function Header() {
  const health = useHealth();
  const overview = useOverview();
  const connected = !!health.data?.ok;
  const alertCount = overview.data?.alerts.total ?? 0;
  const critical = overview.data?.alerts.by_severity.critical ?? 0;

  return (
    <header className="border-b border-noc-border bg-noc-panel/80 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-6 px-6 h-14">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-noc-accent pulse-dot" />
          <span className="font-semibold tracking-wide">MY · NOC</span>
          <span className="text-noc-text-dim text-xs mono">v{health.data?.version ?? '—'}</span>
        </div>
        <nav className="flex items-center gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm rounded-md transition ${
                  isActive
                    ? 'bg-noc-hover text-noc-text'
                    : 'text-noc-text-dim hover:text-noc-text hover:bg-noc-hover'
                }`
              }
            >
              {t.label}
              {t.label === 'Alerts' && alertCount > 0 && (
                <span
                  className={`ml-2 px-1.5 py-0.5 text-[10px] rounded mono ${
                    critical > 0 ? 'bg-noc-critical text-black' : 'bg-noc-warning text-black'
                  }`}
                >
                  {alertCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-xs">
          <span className="text-noc-text-dim">backend</span>
          <span className={`mono ${connected ? 'text-noc-accent' : 'text-noc-critical'}`}>
            {health.isLoading ? 'connecting…' : connected ? 'connected' : 'unreachable'}
          </span>
        </div>
      </div>
    </header>
  );
}
