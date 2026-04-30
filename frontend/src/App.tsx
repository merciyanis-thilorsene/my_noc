import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import Overview from './pages/Overview';
import Gateways from './pages/Gateways';
import GatewayDetail from './pages/GatewayDetail';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Lorawan from './pages/Lorawan';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import { useSettings } from './store/settings';
import { connectLive, disconnectLive } from './ws/client';
import { useLiveBridge } from './ws/bridge';

export default function App() {
  const apiKey = useSettings((s) => s.apiKey);
  useLiveBridge();

  useEffect(() => {
    if (!apiKey) return;
    connectLive();
    return () => disconnectLive();
  }, [apiKey]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={apiKey ? <Overview /> : <Navigate to="/settings" replace />}
        />
        <Route path="gateways"        element={<Gateways />} />
        <Route path="gateways/:eui"   element={<GatewayDetail />} />
        <Route path="devices"         element={<Devices />} />
        <Route path="devices/:eui"    element={<DeviceDetail />} />
        <Route path="lorawan"         element={<Lorawan />} />
        <Route path="alerts"          element={<Alerts />} />
        <Route path="settings"        element={<Settings />} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
