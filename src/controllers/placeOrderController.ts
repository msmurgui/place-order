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
  const { idempotencyKey } = orderToPlace;

  // Atomically claim the key before continuing with order processing.
  // This ensures that only one request with a given key can be in-flight at a time.
  const claimed = await IdempotencyRepository.claim(idempotencyKey, IDEMPOTENCY_TTL_SECONDS);

  if (!claimed) {
    // Either a completed duplicate (cached response present) or a still-in-flight request
    const cached = (await IdempotencyRepository.get<CachedResponse>(idempotencyKey));
    if (cached) {
      res.status(cached.statusCode).json(cached.body);
      return;
    }
    res.status(409).json({ error: 'A request with this idempotency key is already in progress' });
    return;
  }

  try {
    const { order } = await OrderService.placeOrder(orderToPlace);

    const body = {
      orderId: order.id,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      total: order.total,
      warehouseId: order.warehouseId,
      status: order.status,
    };

    // Update or set the cache with the real response now that processing is complete.
    await IdempotencyRepository.set({
      key: idempotencyKey,
      value: { statusCode: 201, body },
      ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
    });

    res.status(201).json(body);
  } catch (error: unknown) {
    // Release the claim so the failed attempt can be retried with the same key.
    await IdempotencyRepository.release(idempotencyKey);
    throw error;
  }
};
