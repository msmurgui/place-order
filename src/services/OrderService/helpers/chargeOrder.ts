import { PaymentGateway } from '../../../gateways/PaymentGateway';
import { redisClient } from '../../../redis';
import { CircuitOpenError } from '../../../util/errors';
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
  const paymentCircuitOpen = await redisClient.get('circuit:payment');
  if (paymentCircuitOpen === '1') throw new CircuitOpenError('payment');

  const { reference } = await withRetry({
    fn: () => PaymentGateway.charge({ total, cardNumber, orderId, orderItemIds }),
    attempts: 2,
    delayMs: 500,
  });

  const paymentStatus = await PaymentGateway.getStatus(reference);
  return { reference, paymentStatus };
};
