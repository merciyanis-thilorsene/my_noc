import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

type Client = { id: string; send: (data: string) => void };
const clients = new Set<Client>();

export async function liveWs(app: FastifyInstance): Promise<void> {
  app.get('/live', { websocket: true }, (socket, req) => {
    const token = ((req.query ?? {}) as { token?: string }).token ?? '';
    if (!token || !config.frontend.apiKeys.has(token)) {
      try {
        socket.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
      } catch {
        /* socket may already be closing */
      }
      socket.close(1008, 'unauthorized');
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const client: Client = { id, send: (data) => socket.send(data) };
    clients.add(client);
    app.log.info({ client_id: id, total: clients.size }, 'ws connected');
    try {
      socket.send(JSON.stringify({ type: 'welcome', server_time: new Date().toISOString() }));
    } catch {
      /* noop */
    }

    socket.on('close', () => {
      clients.delete(client);
      app.log.info({ client_id: id, total: clients.size }, 'ws disconnected');
    });
    socket.on('error', (err: unknown) => {
      app.log.warn({ err, client_id: id }, 'ws error');
    });
  });

  // 25s heartbeat so idle proxies don't drop the connection.
  const heartbeat = setInterval(() => {
    const payload = JSON.stringify({ type: 'ping', ts: new Date().toISOString() });
    for (const c of clients) {
      try { c.send(payload); } catch { /* drop silently; close event will reap */ }
    }
  }, 25_000);
  app.addHook('onClose', async () => clearInterval(heartbeat));
}

export function broadcast(event: string, payload: unknown): void {
  const message = JSON.stringify({ type: event, payload, ts: new Date().toISOString() });
  for (const c of clients) {
    try { c.send(message); } catch { /* noop */ }
  }
}
