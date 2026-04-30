import { wsBase } from '../api/client';
import { useSettings } from '../store/settings';

type LiveEvent = { type: string; payload?: unknown; ts?: string };
type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let closedByUser = false;

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function connectLive(): void {
  closedByUser = false;
  const { apiKey } = useSettings.getState();
  if (!apiKey) return;

  const url = `${wsBase()}/ws/live?token=${encodeURIComponent(apiKey)}`;

  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => { reconnectAttempt = 0; });
  socket.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data) as LiveEvent;
      for (const l of listeners) l(msg);
    } catch { /* ignore malformed frames */ }
  });
  socket.addEventListener('close', () => {
    socket = null;
    if (!closedByUser) scheduleReconnect();
  });
  // error: close fires after, reconnect happens there.
  socket.addEventListener('error', () => {});
}

export function disconnectLive(): void {
  closedByUser = true;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

function scheduleReconnect(): void {
  const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => connectLive(), delay);
}
