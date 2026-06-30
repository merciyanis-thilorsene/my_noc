import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import 'uplot/dist/uPlot.min.css';
import './styles.css';
import { applyTheme, getTheme } from './lib/theme';

applyTheme(getTheme());
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Export from './pages/Export';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'devices', element: <Devices /> },
      { path: 'devices/:devEui', element: <DeviceDetail /> },
      { path: 'export', element: <Export /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
