import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { applyTheme, getTheme, ThemeName } from '../lib/theme';

export default function Layout() {
  const [theme, setTheme] = useState<ThemeName>(getTheme());
  const toggle = () => {
    const next: ThemeName = theme === 'sharingan' ? 'slate' : 'sharingan';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}sharingan.svg`} alt="Sharingan" width={24} height={24} />
        </div>
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/control">Control</NavLink>
          <NavLink to="/export">Export</NavLink>
        </nav>
        <div className="spacer" />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggle}
          title={`Switch to ${theme === 'sharingan' ? 'Slate' : 'Sharingan'} theme`}
        >
          {theme === 'sharingan' ? '🔴 Sharingan' : '🌙 Slate'}
        </button>
        <a href={`${import.meta.env.BASE_URL}api/health`} target="_blank" rel="noreferrer" className="muted mono">health</a>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
