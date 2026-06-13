import { PaymentGateway } from '../../../gateways/PaymentGateway';
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
  return { reference, paymentStatus };
};
