import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Lo<span>Ra</span>WAN Monitor</div>
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/devices">Devices</NavLink>
        </nav>
        <div className="spacer" />
        <a href="/api/health" target="_blank" rel="noreferrer" className="muted mono">health</a>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
