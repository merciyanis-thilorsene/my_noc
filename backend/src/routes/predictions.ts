import type { FastifyInstance } from 'fastify';

// Phase 2 will swap these stubs for proxies to config.ml.serviceUrl.
// The `ml_service_not_deployed` flag keeps the dashboard contract stable.
const stub = () => ({ ml_service_not_deployed: true, predictions: null });

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/predictions/gateways/:eui/traffic',        async () => stub());
  app.get('/predictions/devices/:dev_eui/battery',     async () => stub());
  app.get('/predictions/devices/:dev_eui/anomaly-score', async () => stub());
}
