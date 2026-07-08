/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { type Logger } from 'scripts/lib/logger';
import { type default as WmcClient } from 'scripts/lib/wmcClient';
import { type default as Geocoder } from 'scripts/lib/geocoder';
import { parseRange, resolveBucket, BUCKET_SECONDS } from 'scripts/lib/time';
import { normalizeEui } from 'scripts/webhooks/tts';
import {
  getGateway,
  getGatewayAlerts,
  getGatewayDevices,
  getGatewayObserved,
  getGatewaySeries,
  listGatewaysWithTraffic,
  listRecentAlerts,
  updateGatewayNocFields,
  type GatewayListItem,
} from 'scripts/db/gatewayQueries';

/**
 * How many `message_interval`s past `last_status_at` a gateway may go silent before the NOC
 * marks it stale, independent of WMC's own `status` enum.
 */
const STALE_FACTOR = 3;

/**
 * Floor on the staleness window. `message_interval` can be as low as 30s (Kerlink keepalive)
 * while WMC is only re-polled every WMC_POLL_INTERVAL_SEC, so without a floor every gateway
 * would look stale a couple of minutes after each poll.
 */
const STALE_FLOOR_MS = 10 * 60_000;

/**
 * Dependencies the gateway routes need beyond the database.
 */
export interface GatewayRouteDeps {
  wmcClient: WmcClient | null;
  geocoder: Geocoder | null;
}

/**
 * Computes the NOC-derived stale flag from the last WMC status time and expected message
 * interval. Returns `false` when any input is missing (nothing to derive from).
 */
function isStale(row: GatewayListItem): boolean {
  if (row.last_status_at === null || row.message_interval === null || row.message_interval <= 0) {
    return false;
  }
  const windowMs = Math.max(row.message_interval * 1_000 * STALE_FACTOR, STALE_FLOOR_MS);
  return Date.parse(row.last_status_at) + windowMs < Date.now();
}

/**
 * GET /api/gateways — every gateway known from WMC or observed traffic, with 24h traffic,
 * active-alert count, and a NOC-derived stale flag.
 */
function listHandler(db: Db): unknown {
  const range = parseRange('24h', undefined, Date.now());
  const items = listGatewaysWithTraffic(db, range.from).map((row) => ({
    ...row,
    stale: isStale(row),
  }));
  return { items };
}

/**
 * Resolves the `:gw_eui` route param to canonical form, or `null` if empty.
 */
function gwEuiParam(request: FastifyRequest): string | null {
  return normalizeEui((request.params as { gw_eui?: string }).gw_eui);
}

/**
 * GET /api/gateways/:gw_eui — WMC metadata + NOC fields + observed 24h traffic + vitals
 * (fetched on demand from WMC) + alert history.
 */
async function detailHandler(
  db: Db,
  deps: GatewayRouteDeps,
  logger: Logger,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const gwEui = gwEuiParam(request);
  const gateway = gwEui === null ? undefined : getGateway(db, gwEui);
  // A gateway may be known only from observed traffic and have no `gateways` row yet.
  const observedOnly = gwEui !== null && gateway === undefined;
  if (gwEui === null) {
    return reply.status(404).send({ error: 'GATEWAY_NOT_FOUND' });
  }
  const range = parseRange('24h', undefined, Date.now());
  const observed = getGatewayObserved(db, gwEui, range.from);
  if (gateway === undefined && observed.uplinks_relayed === 0) {
    return reply.status(404).send({ error: 'GATEWAY_NOT_FOUND' });
  }

  let vitals: unknown[] = [];
  const customerId = gateway?.customer_id ?? null;
  if (deps.wmcClient !== null && customerId !== null) {
    try {
      vitals = await deps.wmcClient.getGatewayHealth(customerId, gwEui);
    } catch (error) {
      logger.warn({ err: error, gwEui }, '[wmc] Failed to fetch gateway vitals.');
    }
  }

  return {
    gateway: gateway ?? null,
    observed_only: observedOnly,
    observed,
    vitals,
    alerts: getGatewayAlerts(db, gwEui),
  };
}

/**
 * GET /api/gateways/:gw_eui/devices — devices this gateway has heard in the window.
 */
function devicesHandler(db: Db, request: FastifyRequest): unknown {
  const gwEui = gwEuiParam(request);
  const query = request.query as { from?: string; to?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());
  return {
    from: range.from,
    to: range.to,
    items: gwEui === null ? [] : getGatewayDevices(db, gwEui, range.from),
  };
}

/**
 * GET /api/gateways/:gw_eui/series — bucketed observed traffic + RF for the detail charts.
 */
function seriesHandler(db: Db, request: FastifyRequest): unknown {
  const gwEui = gwEuiParam(request);
  const query = request.query as { from?: string; to?: string; bucket?: string };
  const range = parseRange(query.from ?? '24h', query.to, Date.now());
  const bucket = resolveBucket(query.bucket, range.fromMs, range.toMs);
  return {
    bucket,
    from: range.from,
    to: range.to,
    series: gwEui === null ? [] : getGatewaySeries(db, gwEui, range.from, BUCKET_SECONDS[bucket]),
  };
}

/**
 * PUT /api/gateways/:gw_eui — set operator-owned NOC fields. A supplied lat/lng is stored as a
 * manual coordinate; otherwise a supplied address is geocoded (best effort) when a geocoder is
 * configured. WMC-sourced fields are never touched.
 */
async function updateHandler(
  db: Db,
  deps: GatewayRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const gwEui = gwEuiParam(request);
  if (gwEui === null) {
    return reply.status(400).send({ error: 'INVALID_GATEWAY_EUI' });
  }
  const body = request.body as {
    site_name?: string | null;
    deployment_address?: string | null;
    deployment_lat?: number | null;
    deployment_lng?: number | null;
    notes?: string | null;
  };
  const existing = getGateway(db, gwEui);

  const siteName = body.site_name !== undefined ? body.site_name : (existing?.site_name ?? null);
  const notes = body.notes !== undefined ? body.notes : (existing?.notes ?? null);
  const deploymentAddress = body.deployment_address !== undefined
    ? body.deployment_address
    : (existing?.deployment_address ?? null);

  let deploymentLat = existing?.deployment_lat ?? null;
  let deploymentLng = existing?.deployment_lng ?? null;
  let coordSource = existing?.deployment_coord_source ?? null;

  const { deployment_lat: manualLat, deployment_lng: manualLng } = body;
  if (typeof manualLat === 'number' && typeof manualLng === 'number') {
    deploymentLat = manualLat;
    deploymentLng = manualLng;
    coordSource = 'manual';
  } else if (
    typeof deploymentAddress === 'string'
    && deploymentAddress !== ''
    && deploymentAddress !== (existing?.deployment_address ?? null)
    && deps.geocoder !== null
  ) {
    const coords = await deps.geocoder.geocode(deploymentAddress);
    if (coords !== null) {
      deploymentLat = coords.latitude;
      deploymentLng = coords.longitude;
      coordSource = 'geocoded';
    }
  }

  updateGatewayNocFields(db, {
    gwEui,
    siteName,
    deploymentAddress,
    deploymentLat,
    deploymentLng,
    deploymentCoordSource: coordSource,
    notes,
    updatedByNocAt: new Date().toISOString(),
  });
  return getGateway(db, gwEui);
}

/**
 * Whether WMC currently holds a surveyed/GPS coordinate we should not overwrite with an
 * approximate geocode. The exact WMC `location_type` vocabulary should be confirmed against a
 * live tenant; we match GPS/survey substrings case-insensitively.
 */
function wmcHasSurveyedFix(
  latitude: number | null,
  longitude: number | null,
  locationType: string | null,
): boolean {
  if (latitude === null || longitude === null) {
    return false;
  }
  const type = (locationType ?? '').toLowerCase();
  return type.includes('gps') || type.includes('survey');
}

/**
 * POST /api/gateways/:gw_eui/sync-location — push the NOC deployment coordinate to WMC, guarding
 * against replacing a WMC-held surveyed/GPS fix with an approximate geocode unless `force`.
 */
async function syncLocationHandler(
  db: Db,
  deps: GatewayRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const gwEui = gwEuiParam(request);
  const gateway = gwEui === null ? undefined : getGateway(db, gwEui);
  if (gwEui === null || gateway === undefined) {
    return reply.status(404).send({ error: 'GATEWAY_NOT_FOUND' });
  }
  if (deps.wmcClient === null) {
    return reply.status(501).send({
      error: 'WMC_NOT_CONFIGURED',
      message: 'Set WMC_BASE_URL, WMC_LOGIN, and WMC_PASSWORD to enable syncing.',
    });
  }
  if (gateway.deployment_lat === null || gateway.deployment_lng === null) {
    return reply.status(400).send({
      error: 'NO_DEPLOYMENT_COORDS',
      message: 'Set a deployment address or coordinates before syncing to WMC.',
    });
  }
  if (gateway.customer_id === null) {
    return reply.status(400).send({
      error: 'UNKNOWN_CUSTOMER',
      message: 'This gateway has no WMC customer id (never polled); cannot address the WMC API.',
    });
  }

  const force = (request.body as { force?: boolean } | undefined)?.force === true;
  const wmcSurveyed = wmcHasSurveyedFix(
    gateway.wmc_latitude,
    gateway.wmc_longitude,
    gateway.wmc_location_type,
  );
  const guardHit = wmcSurveyed && gateway.deployment_coord_source === 'geocoded';
  if (guardHit && !force) {
    return reply.status(409).send({
      error: 'WMC_HAS_SURVEYED_FIX',
      message: 'WMC holds a surveyed/GPS coordinate and the NOC value is a geocoded approximation. '
        + 'Re-send with force=true to overwrite it.',
    });
  }

  try {
    await deps.wmcClient.putGatewayLocation(
      gateway.customer_id,
      gwEui,
      gateway.deployment_lat,
      gateway.deployment_lng,
    );
  } catch (error) {
    return reply.status(502).send({ error: 'WMC_SYNC_FAILED', message: String(error) });
  }
  return {
    ok: true,
    pushed: { latitude: gateway.deployment_lat, longitude: gateway.deployment_lng },
  };
}

/**
 * Registers the gateway read/write routes.
 */
export default function registerGatewayRoutes(
  instance: FastifyInstance,
  db: Db,
  logger: Logger,
  deps: GatewayRouteDeps,
): void {
  instance.get('/api/gateways', () => listHandler(db));
  instance.get('/api/alerts', (request) => {
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = Number.parseInt(limitRaw ?? '30', 10);
    return { items: listRecentAlerts(db, Number.isNaN(limit) ? 30 : Math.min(limit, 200)) };
  });
  instance.get(
    '/api/gateways/:gw_eui',
    (request, reply) => detailHandler(db, deps, logger, request, reply),
  );
  instance.get('/api/gateways/:gw_eui/devices', (request) => devicesHandler(db, request));
  instance.get('/api/gateways/:gw_eui/series', (request) => seriesHandler(db, request));
  instance.put('/api/gateways/:gw_eui', (request, reply) => updateHandler(db, deps, request, reply));
  instance.post(
    '/api/gateways/:gw_eui/sync-location',
    (request, reply) => syncLocationHandler(db, deps, request, reply),
  );
}
