import { PaymentDeclinedError, PaymentGateway } from '../../../gateways/PaymentGateway';
import { assertCircuitClosed } from '../../../middleware/circuitBreaker';
import { withRetry } from '../../../util/retry';

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

  const paymentStatus = await PaymentGateway.getStatus(reference);

  // A failed payment could either be declined by the payment processor or fail due to an 
  // error. In either case, throw an error to trigger the order release and reconciliation flow.
  if (paymentStatus === 'failed') {
    throw new PaymentDeclinedError('payment failed after charge');
  }

  // Only 'succeeded' or 'unknown' (still settling) reach the caller.
  return { reference, paymentStatus };
};
