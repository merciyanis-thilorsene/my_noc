/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Db } from 'scripts/db/connection';
import { type Configuration } from 'scripts/conf/config';
import { type Logger } from 'scripts/lib/logger';
import { normalizeEui } from 'scripts/webhooks/tts';
import { upsertGatewayFromWmc, type WmcGatewayUpsert } from 'scripts/db/gatewayQueries';
import { type default as WmcClient, type WmcGateway } from 'scripts/lib/wmcClient';

/** Gateways fetched per WMC page. */
const PAGE_SIZE = 100;

/**
 * Picks the first WMC location carrying both coordinates. `location_type` is preserved so the
 * deployment-address sync can tell a surveyed/GPS fix from an approximate one.
 */
function pickLocation(gateway: WmcGateway): {
  latitude: number | null;
  longitude: number | null;
  locationType: string | null;
} {
  const locations = gateway.locations ?? [];
  const located = locations.find((l) => l.latitude !== undefined && l.longitude !== undefined);
  if (located === undefined) {
    return { latitude: null, longitude: null, locationType: null };
  }
  return {
    latitude: located.latitude ?? null,
    longitude: located.longitude ?? null,
    locationType: located.location_type ?? null,
  };
}

/**
 * Maps a WMC gateway to the upsert shape, or `null` when it lacks a usable EUI.
 */
function toUpsert(gateway: WmcGateway, polledAt: string): WmcGatewayUpsert | null {
  const gwEui = normalizeEui(gateway.gwEui);
  if (gwEui === null) {
    return null;
  }
  const location = pickLocation(gateway);
  return {
    gwEui,
    name: gateway.name ?? null,
    customerId: gateway.customerId ?? null,
    status: gateway.connectionStatus?.status ?? null,
    messageInterval: gateway.connectionStatus?.messageInterval ?? null,
    lastStatusAt: gateway.connectionStatus?.lastUpdateTime ?? null,
    wmcLatitude: location.latitude,
    wmcLongitude: location.longitude,
    wmcLocationType: location.locationType,
    createdAt: gateway.creationDate ?? null,
    lastPolledAt: polledAt,
  };
}

/**
 * Yields the event loop between pages so a long poll doesn't block HTTP handling — the single
 * synchronous SQLite connection serves webhook ingest and reads on the same thread.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve); });
}

/** Writes one page of gateway upserts in a single short transaction. */
type WritePage = (items: WmcGatewayUpsert[]) => void;

/**
 * Fetches and upserts one customer's gateways page by page. Recursion (rather than a loop with
 * awaits) keeps each page's write transaction short and yields the event loop between pages
 * without tripping the no-await-in-loop rule. Returns the number of gateways upserted.
 */
async function pollCustomerPages(
  wmcClient: WmcClient,
  writePage: WritePage,
  customerId: number,
  offset: number,
  total: number,
): Promise<number> {
  if (offset >= total) {
    return 0;
  }
  const page = await wmcClient.listGateways(customerId, offset, PAGE_SIZE);
  const polledAt = new Date().toISOString();
  const upserts = page.gateways
    .map((gateway) => toUpsert(gateway, polledAt))
    .filter((item): item is WmcGatewayUpsert => item !== null);
  writePage(upserts);
  if (page.gateways.length === 0) {
    return upserts.length;
  }
  await yieldToEventLoop();
  const rest = await pollCustomerPages(
    wmcClient,
    writePage,
    customerId,
    offset + PAGE_SIZE,
    page.total,
  );
  return upserts.length + rest;
}

/**
 * Runs one full poll: for each accessible customer, page through gateways and upsert each page
 * in its own short transaction. Customers are processed sequentially via a promise chain; WMC
 * failures are logged per customer and never thrown.
 */
async function pollOnce(db: Db, wmcClient: WmcClient, logger: Logger): Promise<void> {
  const customerIds = await wmcClient.getCustomerIds();
  const writePage = db.transaction((items: WmcGatewayUpsert[]) => {
    items.forEach((item) => { upsertGatewayFromWmc(db, item); });
  });

  await customerIds.reduce<Promise<void>>(async (previous, customerId) => {
    await previous;
    try {
      const upserted = await pollCustomerPages(
        wmcClient,
        writePage,
        customerId,
        0,
        Number.POSITIVE_INFINITY,
      );
      logger.info({ customerId, upserted }, '[wmc] Polled gateways.');
    } catch (error) {
      logger.error({ err: error, customerId }, '[wmc] Poll failed for customer.');
    }
  }, Promise.resolve());
}

/**
 * Starts the WMC gateway poller on a fixed interval. Returns a stop function that cancels the
 * schedule. When WMC is not configured (`wmcClient` is `null`) the poller is a no-op — gateways
 * then come only from observed `uplink_gateways`.
 *
 * @param db Database connection.
 *
 * @param wmcClient WMC client, or `null` when WMC is not configured.
 *
 * @param config Application configuration.
 *
 * @param logger Logger instance.
 *
 * @returns A function that stops the poller.
 */
export default function startWmcPoller(
  db: Db,
  wmcClient: WmcClient | null,
  config: Configuration,
  logger: Logger,
): () => void {
  if (wmcClient === null) {
    logger.info('[wmc] Not configured; gateway poller disabled.');
    return () => { /* no-op: poller disabled when WMC is unconfigured */ };
  }

  let running = false;
  const run = (): void => {
    if (running) {
      logger.warn('[wmc] Previous poll still running; skipping this tick.');
      return;
    }
    running = true;
    pollOnce(db, wmcClient, logger)
      .catch((error: unknown) => { logger.error({ err: error }, '[wmc] Poll cycle failed.'); })
      .finally(() => { running = false; });
  };

  // First poll shortly after startup, then on the configured interval.
  const startTimer = setTimeout(run, 5_000);
  const intervalTimer = setInterval(run, config.wmcPollIntervalSec * 1_000);
  logger.info({ intervalSec: config.wmcPollIntervalSec }, '[wmc] Gateway poller armed.');

  return () => {
    clearTimeout(startTimer);
    clearInterval(intervalTimer);
  };
}
