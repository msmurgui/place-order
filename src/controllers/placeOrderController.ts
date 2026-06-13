import type { Request, Response } from 'express';
import { IdempotencyRepository } from '../repositories/IdempotencyRepository';
import { OrderService } from '../services/OrderService/OrderService';
import type { PlaceOrderRequestBody } from './placeOrderSchema';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h

interface CachedResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export const placeOrderController = async (
  req: Request<unknown, unknown, PlaceOrderRequestBody>,
  res: Response
): Promise<void> => {
  const { orderToPlace } = req.body;

  // Idempotency short-circuit: a duplicate submission returns the original response
  // without re-running business logic (no second charge). Only successful responses
  // are cached, so a failed attempt can still be retried.
  const cached = (await IdempotencyRepository.get(
    orderToPlace.idempotencyKey
  )) as CachedResponse | null;
  if (cached) {
    res.status(cached.statusCode).json(cached.body);
    return;
  }

  const { order } = await OrderService.placeOrder(orderToPlace);

  const body = {
    orderId: order.id,
    subtotal: order.subtotal,
    taxAmount: order.taxAmount,
    total: order.total,
    warehouseId: order.warehouseId,
    status: order.status,
  };

  await IdempotencyRepository.set({
    key: orderToPlace.idempotencyKey,
    value: { statusCode: 201, body },
    ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
  });

  res.status(201).json(body);
};
