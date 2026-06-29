import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, proxy API + webhook calls to the backend container (host :8090).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8090',
      '/webhooks': 'http://localhost:8090',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
