import { runtimeConfig } from '../config';
import { useSettings } from '../store/settings';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export function apiBase(): string {
  const override = useSettings.getState().backendOverride.trim();
  if (override) return override.replace(/\/$/, '');
  return runtimeConfig.backendUrl;
}

export function wsBase(): string {
  const base = apiBase();
  if (base) return base.replace(/^http/, 'ws');
  return runtimeConfig.wsUrl;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = useSettings.getState();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string')
        ? (body as { error: string }).error
        : res.statusText;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
