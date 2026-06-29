import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hosted under a path prefix behind Traefik (https://<domain>/monitor). Traefik strips
// `/monitor` before forwarding, so the backend stays path-agnostic; the frontend just needs
// to build with this base so the browser requests `/monitor/...`.
const BASE = '/monitor/';

// In dev, proxy `/monitor/{api,webhooks}` to the backend, rewriting away the prefix so the
// local backend (which serves at root) responds — mirroring what Traefik does in prod.
const stripBase = (p: string) => p.replace(/^\/monitor/, '');

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    proxy: {
      '/monitor/api': { target: 'http://localhost:8090', rewrite: stripBase },
      '/monitor/webhooks': { target: 'http://localhost:8090', rewrite: stripBase },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
