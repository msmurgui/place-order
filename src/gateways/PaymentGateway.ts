import { randomUUID } from 'crypto';

// Use this card number in tests to trigger a declined payment.
export const DECLINED_CARD = '4000000000000002';

export class PaymentDeclinedError extends Error {
  constructor(reason: string) {
    super(`Payment declined: ${reason}`);
    this.name = 'PaymentDeclinedError';
  }
}

export type PaymentStatus = 'succeeded' | 'failed' | 'pending' | 'unknown';

class _PaymentGateway {
  async charge({
    total,
    cardNumber,
    orderId,
    orderItemIds,
  }: {
    total: number;
    cardNumber: string;
    orderId: number;
    orderItemIds: number[];
  }): Promise<{ reference: string }> {
    if (cardNumber === DECLINED_CARD) {
      throw new PaymentDeclinedError('card declined by issuer');
    }

    void total; // real implementation would pass this to the payment processor
    void orderId; // real implementation would pass this to the payment processor as metadata
    void orderItemIds; // real implementation would pass this to the payment processor as metadata
    return { reference: randomUUID() };
  }

  async getStatus(_reference: string): Promise<PaymentStatus> {
    return 'succeeded';
  }
}

export const PaymentGateway = new _PaymentGateway();
