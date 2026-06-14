import express, { type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openapiSpec } from './docs/openapi';
import { errorHandler } from './middleware/errorHandler';
import { ordersRouter } from './routes/orders';

export const createApp = (): Express => {
  const app = express();

  // Controls how req.ip is derived (used by the rate limiter)
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Interactive API docs — browse and fire real requests at GET /docs.
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use(ordersRouter);

  // All unmatched routes return 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Any errors thrown by the routes will be handled by this middleware
  app.use(errorHandler);

  return app;
};
