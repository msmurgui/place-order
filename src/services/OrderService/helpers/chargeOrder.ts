import {
  PaymentDeclinedError,
  PaymentGateway,
  PaymentStatus,
} from '../../../gateways/PaymentGateway';
import { assertCircuitClosed } from '../../../middleware/circuitBreaker';
import { logger } from '../../../util/logger';
import { withRetry } from '../../../util/retry';

/**
 * Charges an order using the payment gateway.
 *
 * @param params
 * @param params.orderId The ID of the order to charge
 * @param params.orderItemIds The IDs of the order items
 * @param params.total The total amount to charge, including taxes.
 * @param params.cardNumber The card number to charge for the order. On a more robust
 *                          implementation, this would likely be a token representing
 *                          the card details, not the raw card number.
 * @returns An object containing the payment reference and status.
 */
export const chargeOrder = async ({
  orderId,
  orderItemIds,
  total,
  cardNumber,
}: {
  orderId: number;
  orderItemIds: number[];
  total: number;
  cardNumber: string;
}) => {
  await assertCircuitClosed('payment');

  const { reference } = await withRetry({
    fn: () => PaymentGateway.charge({ total, cardNumber, orderId, orderItemIds }),
    attempts: 2,
    delayMs: 500,
  });

  let paymentStatus: PaymentStatus;
  try {
    paymentStatus = await withRetry({
      fn: () => PaymentGateway.getStatus(reference),
      attempts: 2,
      delayMs: 500,
    });
  } catch (error: unknown) {
    logger.error({ reference, error }, 'PaymentGateway.getStatus failed, falling back to unknown');
    paymentStatus = 'unknown';
  }

  // A failed payment could either be declined by the payment processor or fail due to an
  // error. In either case, throw an error to trigger the order release and reconciliation flow.
  if (paymentStatus === 'failed') {
    throw new PaymentDeclinedError('payment failed after charge');
  }

  // Only 'succeeded' or 'unknown' (still settling) reach the caller.
  return { reference, paymentStatus };
};
