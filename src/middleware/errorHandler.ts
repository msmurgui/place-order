import type { ErrorRequestHandler } from 'express';
import { PaymentDeclinedError } from '../gateways/PaymentGateway';
import { TaxCalculationError } from '../gateways/TaxGateway';
import { CircuitOpenError, InsufficientInventoryError, NoWarehouseAvailableError } from '../util/errors';
import { logger } from '../util/logger';

// Maps domain errors to HTTP status codes. Anything unrecognized is a 500.
const statusFor = (err: unknown): number => {
  if (err instanceof NoWarehouseAvailableError) return 409;
  if (err instanceof InsufficientInventoryError) return 409;
  if (err instanceof PaymentDeclinedError) return 402;
  if (err instanceof TaxCalculationError) return 422;
  if (err instanceof CircuitOpenError) return 503;
  return 500;
};

// Express identifies an error handler by its four-argument signature, so `next` must stay
// even though it is unused.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = statusFor(err);

  if (status === 500) {
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  const message = err instanceof Error ? err.message : 'Request failed';
  res.status(status).json({ error: message });
};
