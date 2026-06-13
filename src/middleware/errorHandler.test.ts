import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { PaymentDeclinedError } from '../gateways/PaymentGateway';
import { TaxCalculationError } from '../gateways/TaxGateway';
import { CircuitOpenError, InsufficientInventoryError, NoWarehouseAvailableError } from '../util/errors';

vi.mock('../util/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { logger } from '../util/logger';
import { errorHandler } from './errorHandler';

const buildRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const req = {} as Request;
const next = vi.fn() as NextFunction;

afterEach(() => {
  vi.clearAllMocks();
});

describe('errorHandler', () => {
  it.each([
    [new NoWarehouseAvailableError(), 409],
    [new InsufficientInventoryError(), 409],
    [new PaymentDeclinedError('declined'), 402],
    [new TaxCalculationError('BOGUS'), 422],
    [new CircuitOpenError('payment'), 503],
  ])('maps %s to status %i', (err, status) => {
    const res = buildRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: (err as Error).message });
  });

  it('maps an unknown error to 500 with a generic message and logs it', () => {
    const res = buildRes();
    const err = new Error('something internal leaked');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(logger.error).toHaveBeenCalled();
  });
});
