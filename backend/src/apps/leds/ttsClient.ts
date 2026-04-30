import { config } from '../../config.js';

// Thin TTS REST client for write-side calls (NS device PUT, AS downlink push).
// Read-side polling lives in pollers/tts.ts and intentionally does not share
// this file — pollers tolerate failure and continue, action calls must surface
// failures to the caller (alert engine or HTTP route).

const TIMEOUT_MS = 10_000;

export class TtsNotConfiguredError extends Error {
  constructor() {
    super('TTS_BASE_URL or TTS_API_KEY not configured');
    this.name = 'TtsNotConfiguredError';
  }
}

export class TtsApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`TTS ${path} → ${status}: ${body.slice(0, 200)}`);
    this.name = 'TtsApiError';
  }
}

function ensureConfigured(): void {
  if (!config.tts.baseUrl || !config.tts.apiKey) throw new TtsNotConfiguredError();
}

async function request(method: 'PUT' | 'POST', path: string, body: unknown): Promise<unknown> {
  ensureConfigured();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.tts.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TtsApiError(res.status, path, text);
    }
    return res.status === 204 ? null : res.json();
  } finally {
    clearTimeout(t);
  }
}

export const ttsPut  = (path: string, body: unknown): Promise<unknown> => request('PUT',  path, body);
export const ttsPost = (path: string, body: unknown): Promise<unknown> => request('POST', path, body);
