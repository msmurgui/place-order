import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { Order } from '../entities/Order';

vi.mock('../repositories/IdempotencyRepository', () => ({
  IdempotencyRepository: { get: vi.fn(), set: vi.fn() },
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
  vi.mocked(IdempotencyRepository.get).mockResolvedValue(null);
  vi.mocked(IdempotencyRepository.set).mockResolvedValue(undefined);
  vi.mocked(OrderService.placeOrder).mockResolvedValue({ order: confirmedOrder });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('placeOrderController', () => {
  it('places the order, stores the idempotency key, and returns 201', async () => {
    const res = buildRes();

    await placeOrderController(buildReq(), res);

    expect(OrderService.placeOrder).toHaveBeenCalledWith(orderToPlace);
    expect(IdempotencyRepository.set).toHaveBeenCalledWith({
      key: 'idem-1',
      value: { statusCode: 201, body: expectedBody },
      ttlSeconds: 24 * 60 * 60,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expectedBody);
  });

  it('returns the cached response without re-running business logic on a duplicate key', async () => {
    vi.mocked(IdempotencyRepository.get).mockResolvedValue({ statusCode: 201, body: expectedBody });
    const res = buildRes();

    await placeOrderController(buildReq(), res);

    expect(OrderService.placeOrder).not.toHaveBeenCalled();
    expect(IdempotencyRepository.set).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expectedBody);
  });

  it('propagates service errors and does not cache a failed attempt', async () => {
    vi.mocked(OrderService.placeOrder).mockRejectedValue(new Error('payment declined'));
    const res = buildRes();

    await expect(placeOrderController(buildReq(), res)).rejects.toThrow('payment declined');

    expect(IdempotencyRepository.set).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
