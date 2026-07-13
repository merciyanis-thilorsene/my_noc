import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logout, useConfig, useGateways } from '../api';
import { applyTheme, getTheme, type ThemeName } from '../lib/theme';
import { getLang, setLang, L } from '../lib/i18n';

const TABS = [
  { to: '/', label: L.nav.overview, icon: 'dashboard', end: true },
  { to: '/gateways', label: L.nav.gateways, icon: 'router', end: false },
  { to: '/devices', label: L.nav.devices, icon: 'sensors', end: false },
  { to: '/control', label: L.nav.control, icon: 'tune', end: false },
  { to: '/export', label: L.nav.export, icon: 'file_export', end: false },
];

/** "il y a Xs/min" since the fleet query last refreshed — the topbar's liveness signal. */
function UpdatedPill({ updatedAt }: { updatedAt: number }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = updatedAt === 0 ? null : Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const label = secs === null ? L.nav.updating : L.timeAgo(secs);
  return (
    <div className="live-pill">
      <span className="live-dot" />
      <span>{L.nav.updated(label)}</span>
    </div>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const gateways = useGateways();
  const config = useConfig();
  const [theme, setTheme] = useState<ThemeName>(getTheme());

  const onLogout = () => {
    // Clear the cookie, then reload so AuthGate re-probes and shows the login screen.
    logout().finally(() => window.location.reload());
  };
  const activeAlerts = (gateways.data?.items ?? [])
    .reduce((sum, g) => sum + g.active_alerts, 0);

  const toggleLang = () => {
    setLang(getLang() === 'fr' ? 'en' : 'fr');
    // Strings are resolved at module load; a reload applies the new language everywhere.
    window.location.reload();
  };

  const toggleTheme = () => {
    const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
    // uPlot resolves CSS variables to concrete canvas colors when chart options are
    // built; refetching rebuilds every chart with the new theme's palette immediately.
    void queryClient.invalidateQueries();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}sharingan.svg`} alt="Sharingan" />
          <b>Sharingan</b>
        </div>
        <nav>
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}>
              <span className="icon">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="right">
          <UpdatedPill updatedAt={gateways.dataUpdatedAt} />
          <button
            type="button"
            className="bell"
            title={theme === 'dark' ? L.nav.toLight : L.nav.toDark}
            onClick={toggleTheme}
          >
            <span className="icon">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          </button>
          <button
            type="button"
            className="bell mono"
            style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}
            title={L.nav.toLang}
            onClick={toggleLang}
          >
            {getLang() === 'fr' ? 'EN' : 'FR'}
          </button>
          <button
            type="button"
            className="bell"
            title={L.nav.alertsTitle(activeAlerts)}
            onClick={() => navigate('/gateways')}
          >
            <span className="icon">notifications</span>
            {activeAlerts > 0 ? <span className="count">{activeAlerts}</span> : null}
          </button>
          <a
            className="api-link"
            href={`${import.meta.env.BASE_URL}api/health`}
            target="_blank"
            rel="noreferrer"
            title={L.nav.apiHealth}
          >
            <span className="icon">monitor_heart</span>
          </a>
          {config.data?.auth_required === true ? (
            <button type="button" className="bell" title={L.auth.logout} onClick={onLogout}>
              <span className="icon">logout</span>
            </button>
          ) : null}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
