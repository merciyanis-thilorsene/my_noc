/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type FastifyInstance } from 'fastify';
import { type Db } from 'scripts/db/connection';
import { type Configuration } from 'scripts/conf/config';
import { type Logger } from 'scripts/lib/logger';
import { registerWebhookRoutes } from 'scripts/webhooks/handler';
import registerWmcAlertsRoute from 'scripts/webhooks/wmcAlerts';
import registerHealthRoutes from 'scripts/api/health';
import registerOverviewRoutes from 'scripts/api/overview';
import registerDeviceRoutes from 'scripts/api/devices';
import registerFleetMetricsRoutes from 'scripts/api/metrics';
import registerDownlinkRoutes from 'scripts/api/downlink';
import registerGatewayRoutes, { type GatewayRouteDeps } from 'scripts/api/gateways';

/**
 * Wires every HTTP route onto the Fastify instance: TTS + WMC webhook ingest and the read API.
 * The static frontend (SPA fallback) is mounted in a later phase.
 */
export default function declareRoutes(
  instance: FastifyInstance,
  db: Db,
  config: Configuration,
  logger: Logger,
  deps: GatewayRouteDeps,
): void {
  registerWebhookRoutes(instance, { db, logger, webhookSecret: config.webhookSecret });
  registerWmcAlertsRoute(instance, db, logger, config.wmcAlertsWebhookSecret);
  registerHealthRoutes(instance, db, config);
  registerOverviewRoutes(instance, db);
  registerDeviceRoutes(instance, db);
  registerFleetMetricsRoutes(instance, db);
  registerDownlinkRoutes(instance, db, config, logger);
  registerGatewayRoutes(instance, db, logger, deps);
  // Small config surface the frontend reads at load (map tiles, whether WMC is wired).
  instance.get('/api/config', () => ({
    map_tile_url: config.mapTileUrl,
    wmc_enabled: deps.wmcClient !== null,
    wmc_poll_interval_sec: config.wmcPollIntervalSec,
  }));
}
