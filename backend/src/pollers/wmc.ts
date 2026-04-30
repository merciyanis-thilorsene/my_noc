// WMC Cloud (Wanesy) REST poller.
// Base API: {WMC_BASE_URL}/api/v1
// Auth:     POST /users/token with HTTP Basic → { data: { AccessToken } }, then Bearer on subsequent calls.
// Data:     GET /gateways (paginated) + GET /customers/{customerId}/gateways/{gwEui}/health for per-gateway vitals.
//
// If you're running an on-prem WMC with the legacy /gms/application/* shape, this file needs a flag
// switch — the cloud vs. on-prem API contracts diverge.

import { config } from '../config.js';
import { logger } from '../logger.js';
import { pool } from '../db.js';
import { putGatewayRegistry } from '../cache/registry.js';
import { normalizeEui } from '../ingest/normalize.js';
import { evaluateGatewayRules } from '../alerts/engine.js';

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;

let accessToken: string | null = null;
let customerIds: number[] = [];

function apiUrl(path: string): string {
  return `${config.wmc.baseUrl}/api/v1${path}`;
}

// WMC Cloud uses AWS Cognito; the access token is a standard JWT whose
// `cognito:groups` claim holds entries like `WMP4:CUSTOMER:272:` (where 272
// is the customer id the caller has access to). Extract them so we can
// scope polling to the customers this account actually owns, instead of
// hitting the cross-customer `/gateways` endpoint that requires super-admin.
function extractCustomerIdsFromJwt(jwt: string): number[] {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return [];
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const claims = JSON.parse(decoded) as { ['cognito:groups']?: unknown };
    const groups = Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [];
    const ids = new Set<number>();
    for (const g of groups) {
      if (typeof g !== 'string') continue;
      const m = /^WMP4:CUSTOMER:(\d+):/.exec(g);
      if (m && m[1]) ids.add(Number(m[1]));
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fn(controller.signal); }
  finally { clearTimeout(t); }
}

async function login(): Promise<void> {
  const basic = Buffer.from(`${config.wmc.login}:${config.wmc.password}`).toString('base64');
  const res = await withTimeout((signal) =>
    fetch(apiUrl('/users/token'), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      signal,
    }),
  );
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`WMC login → ${res.status} (${snippet})`);
  }
  const body = (await res.json()) as { data?: { AccessToken?: string } };
  accessToken = body.data?.AccessToken ?? null;
  if (!accessToken) throw new Error('WMC login: no AccessToken in response');
  customerIds = extractCustomerIdsFromJwt(accessToken);
  logger.info({ customer_ids: customerIds }, 'wmc: authenticated');
}

async function wmcFetch<T>(path: string): Promise<T> {
  if (!accessToken) await login();
  const doFetch = (): Promise<Response> =>
    withTimeout((signal) =>
      fetch(apiUrl(path), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal,
      }),
    );

  let res = await doFetch();
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`WMC ${path} → ${res.status} (${snippet})`);
  }
  return (await res.json()) as T;
}

type GatewayListItem = {
  gwEui: string;
  name?: string;
  description?: string | null;
  customerId: number;
  connectionStatus?: string | { status?: string } | null;
  creationDate?: string;
};

function statusString(s: GatewayListItem['connectionStatus']): string | null {
  if (!s) return null;
  if (typeof s === 'string') return s;
  if (typeof s === 'object' && typeof s.status === 'string') return s.status;
  return null;
}
type GatewayListResponse = {
  data: GatewayListItem[];
  metadata?: { total?: number; offset?: number; limit?: number };
};

type VitalElement = { name: string; value: number | string | unknown; date?: string };
type VitalsResponse = { data: { gwEUI?: string; vitals: VitalElement[] } };

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function vitalsToKpis(vitals: VitalElement[]): {
  cpu_pct: number | null;
  ram_pct: number | null;
  temperature_c: number | null;
  uptime_s: number | null;
  backhaul_type: string | null;
  firmware_version: string | null;
} {
  let cpu: number | null = null;
  let ram: number | null = null;
  let temp: number | null = null;
  let up: number | null = null;
  let backhaul: string | null = null;
  let firmware: string | null = null;

  for (const v of vitals) {
    switch (v.name) {
      case 'cpu_percent':                cpu = num(v.value); break;
      case 'memory_percent':             ram = num(v.value); break;
      case 'temperature':                temp = num(v.value); break;
      case 'uptime':                     up = num(v.value); break;
      case 'network_interface_category': backhaul = typeof v.value === 'string' ? v.value : null; break;
      case 'installed_packages': {
        // firmware info lives inside the installed_packages list (e.g. keros 5.10.1-0-gc7e2b007)
        if (Array.isArray(v.value)) {
          const keros = (v.value as Array<{ name?: string; version?: string }>).find(
            (p) => typeof p?.name === 'string' && /keros/i.test(p.name),
          );
          if (keros?.version) firmware = keros.version;
        }
        break;
      }
    }
  }
  return { cpu_pct: cpu, ram_pct: ram, temperature_c: temp, uptime_s: up, backhaul_type: backhaul, firmware_version: firmware };
}

export async function pollWmc(): Promise<void> {
  if (!config.wmc.baseUrl || !config.wmc.login || !config.wmc.password) return;

  // Ensure we have a token so customerIds is populated.
  if (!accessToken) {
    try { await login(); }
    catch (err) {
      logger.warn({ err: (err as Error).message }, 'wmc: login failed');
      return;
    }
  }

  const scopes = customerIds.length > 0
    ? customerIds.map((id) => `/customers/${id}/gateways`)
    : ['/gateways']; // fallback for super-admin accounts without explicit customer scopes

  let allGateways: GatewayListItem[] = [];
  try {
    for (const base of scopes) {
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await wmcFetch<GatewayListResponse>(
          `${base}?offset=${offset}&limit=${PAGE_SIZE}`,
        );
        const items = Array.isArray(page.data) ? page.data : [];
        allGateways = allGateways.concat(items);
        total = typeof page.metadata?.total === 'number' ? page.metadata.total : items.length;
        offset += items.length;
        if (items.length === 0) break;
      }
    }
    logger.info(
      { count: allGateways.length, customers: customerIds.length || 'all' },
      'wmc: gateway list fetched',
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'wmc: list fetch failed');
    accessToken = null;
    return;
  }

  const timestamp = new Date().toISOString();
  let kpiRowsInserted = 0;
  let vitalsFailures = 0;

  for (const gw of allGateways) {
    const eui = normalizeEui(gw.gwEui);
    if (!eui) continue;

    await putGatewayRegistry(eui, {
      gateway_id: gw.name ?? null,
      name: gw.name ?? null,
      description: gw.description ?? null,
      customer_id: gw.customerId,
      wmc_source: true,
    });

    let kpis = {
      cpu_pct: null as number | null,
      ram_pct: null as number | null,
      temperature_c: null as number | null,
      uptime_s: null as number | null,
      backhaul_type: null as string | null,
      firmware_version: null as string | null,
    };
    try {
      const vitals = await wmcFetch<VitalsResponse>(
        `/customers/${gw.customerId}/gateways/${gw.gwEui}/health`,
      );
      if (Array.isArray(vitals.data?.vitals)) {
        kpis = vitalsToKpis(vitals.data.vitals);
      }
    } catch (err) {
      vitalsFailures += 1;
      logger.debug({ err: (err as Error).message, eui }, 'wmc: vitals fetch failed');
    }

    await pool.query(
      `INSERT INTO gateway_kpis
        (timestamp, gateway_eui, connection_status, cpu_pct, ram_pct,
         temperature_c, ping_rtt_ms, backhaul_type, firmware_version, uptime_s)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        timestamp, eui,
        statusString(gw.connectionStatus),
        kpis.cpu_pct, kpis.ram_pct, kpis.temperature_c,
        null, // ping_rtt_ms not exposed by WMC cloud vitals
        kpis.backhaul_type, kpis.firmware_version, kpis.uptime_s,
      ],
    );
    kpiRowsInserted += 1;

    if (kpis.firmware_version) {
      await putGatewayRegistry(eui, { firmware_version: kpis.firmware_version });
    }
  }

  logger.info(
    { gateways: allGateways.length, kpi_rows: kpiRowsInserted, vitals_failures: vitalsFailures },
    'wmc: kpis refreshed',
  );

  // Fresh KPIs land → run gateway rules immediately instead of waiting up
  // to 60s for the scheduled alert tick.
  try { await evaluateGatewayRules(); }
  catch (err) { logger.warn({ err: (err as Error).message }, 'alert eval after WMC poll failed'); }
}
