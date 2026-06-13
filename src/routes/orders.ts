import { Router } from 'express';
import { placeOrderController } from '../controllers/placeOrderController';
import { placeOrderSchema } from '../controllers/placeOrderSchema';
import { rateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validateBody';

export const ordersRouter = Router();

/**
 * @POST /orders
 *
 * Places a new order by finding a warehouse with available stock, reserving the items,
 * and charging the payment method.
 */
ordersRouter.post('/orders', rateLimiter, validateBody(placeOrderSchema), placeOrderController);
