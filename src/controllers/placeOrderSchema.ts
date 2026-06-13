import { z } from 'zod';

// Validation schema for place order request body
export const placeOrderSchema = z.object({
  orderToPlace: z.object({
    customerId: z.number().int().positive(),
    shippingAddress: z.string().min(1),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        })
      )
      .min(1),
    cardNumber: z.string().min(1),
    // Idempotency key is required to prevent duplicate orders from retries
    idempotencyKey: z.string().min(1),
  }),
});

export type PlaceOrderRequestBody = z.infer<typeof placeOrderSchema>;
