import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Order } from '../entities/Order';

vi.mock('../repositories/IdempotencyRepository', () => ({
  IdempotencyRepository: { claim: vi.fn(), get: vi.fn(), set: vi.fn(), release: vi.fn() },
}));
vi.mock('../services/OrderService/OrderService', () => ({ OrderService: { placeOrder: vi.fn() } }));

import { IdempotencyRepository } from '../repositories/IdempotencyRepository';
import { OrderService } from '../services/OrderService/OrderService';
import { placeOrderController } from './placeOrderController';

const orderToPlace = {
  customerId: 1,
  shippingAddress: '123 Main St',
  items: [{ productId: 1, quantity: 2 }],
  cardNumber: '4111111111111111',
  idempotencyKey: 'idem-1',
};

const confirmedOrder = {
  id: 10,
  subtotal: 100,
  taxAmount: 10,
  total: 110,
  warehouseId: 3,
  status: 'CONFIRMED',
} as Order;

const expectedBody = {
  orderId: 10,
  subtotal: 100,
  taxAmount: 10,
  total: 110,
  warehouseId: 3,
  status: 'CONFIRMED',
};

const buildRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildReq = (): Request => ({ body: { orderToPlace } }) as Request;

beforeEach(() => {
  vi.mocked(IdempotencyRepository.claim).mockResolvedValue(true);
  vi.mocked(IdempotencyRepository.get).mockResolvedValue(null);
  vi.mocked(IdempotencyRepository.set).mockResolvedValue(undefined);
  vi.mocked(IdempotencyRepository.release).mockResolvedValue(undefined);
  vi.mocked(OrderService.placeOrder).mockResolvedValue({ order: confirmedOrder });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('placeOrderController', () => {
  it('claims the key, places the order, stores the response, and returns 201', async () => {
    const res = buildRes();

    await placeOrderController(buildReq(), res);

    expect(IdempotencyRepository.claim).toHaveBeenCalledWith('idem-1', 24 * 60 * 60);
    expect(OrderService.placeOrder).toHaveBeenCalledWith(orderToPlace);
    expect(IdempotencyRepository.set).toHaveBeenCalledWith({
      key: 'idem-1',
      value: { statusCode: 201, body: expectedBody },
      ttlSeconds: 24 * 60 * 60,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expectedBody);
  });

  it('returns the cached response without re-running business logic on a completed duplicate', async () => {
    vi.mocked(IdempotencyRepository.claim).mockResolvedValue(false);
    vi.mocked(IdempotencyRepository.get).mockResolvedValue({ statusCode: 201, body: expectedBody });
    const res = buildRes();

    await placeOrderController(buildReq(), res);

    expect(OrderService.placeOrder).not.toHaveBeenCalled();
    expect(IdempotencyRepository.set).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expectedBody);
  });

  it('returns 409 when a request with the same key is still in flight', async () => {
    vi.mocked(IdempotencyRepository.claim).mockResolvedValue(false);
    vi.mocked(IdempotencyRepository.get).mockResolvedValue(null);
    const res = buildRes();

    await placeOrderController(buildReq(), res);

    expect(OrderService.placeOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('releases the claim and propagates the error when the service throws', async () => {
    vi.mocked(OrderService.placeOrder).mockRejectedValue(new Error('payment declined'));
    const res = buildRes();

    await expect(placeOrderController(buildReq(), res)).rejects.toThrow('payment declined');

    expect(IdempotencyRepository.release).toHaveBeenCalledWith('idem-1');
    expect(IdempotencyRepository.set).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
