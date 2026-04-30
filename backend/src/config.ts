import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  TTS_BASE_URL: z.string().default(''),
  TTS_API_KEY: z.string().default(''),
  TTS_APP_IDS: z.string().default(''),
  TTS_WEBHOOK_SECRET: z.string().default(''),
  TTS_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(300),

  WMC_BASE_URL: z.string().default(''),
  WMC_LOGIN: z.string().default(''),
  WMC_PASSWORD: z.string().default(''),
  WMC_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(120),

  FRONTEND_API_KEYS: z.string().min(1, 'FRONTEND_API_KEYS must be set'),
  CORS_ORIGINS: z.string().default('*'),

  ML_SERVICE_URL: z.string().url().or(z.literal('')).default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, '');

// Accept a base URL, normalize (trim whitespace, drop trailing slashes). Returns '' when
// the input is empty or doesn't parse as an http(s) URL — the poller uses '' as its
// "not configured" signal and simply skips, which beats crash-looping on a typo.
const normalizeBaseUrl = (raw: string, name: string): string => {
  const s = raw.trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http protocol');
    return stripTrailingSlash(s);
  } catch (err) {
    console.warn(`[config] ignoring invalid ${name}="${s.slice(0, 40)}…": ${(err as Error).message}`);
    return '';
  }
};

export const config = {
  env: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  port: env.PORT,
  host: env.HOST,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  tts: {
    baseUrl: normalizeBaseUrl(env.TTS_BASE_URL, 'TTS_BASE_URL'),
    apiKey: env.TTS_API_KEY,
    appIds: env.TTS_APP_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    webhookSecret: env.TTS_WEBHOOK_SECRET,
    pollIntervalSec: env.TTS_POLL_INTERVAL_SEC,
  },
  wmc: {
    baseUrl: normalizeBaseUrl(env.WMC_BASE_URL, 'WMC_BASE_URL'),
    login: env.WMC_LOGIN,
    password: env.WMC_PASSWORD,
    pollIntervalSec: env.WMC_POLL_INTERVAL_SEC,
  },
  frontend: {
    apiKeys: new Set(
      env.FRONTEND_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean),
    ),
    corsOrigins:
      env.CORS_ORIGINS === '*'
        ? true
        : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
  },
  ml: {
    serviceUrl: env.ML_SERVICE_URL,
    deployed: env.ML_SERVICE_URL !== '',
  },
} as const;

export type Config = typeof config;
