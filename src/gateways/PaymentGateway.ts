import { randomUUID } from 'crypto';

// Use this card number in tests to trigger a declined payment.
export const DECLINED_CARD = '4000000000000002';

export class PaymentDeclinedError extends Error {
  constructor(reason: string) {
    super(`Payment declined: ${reason}`);
    this.name = 'PaymentDeclinedError';
  }
}

class _PaymentGateway {
  async charge({
    total,
    cardNumber,
  }: {
    total: number;
    cardNumber: string;
  }): Promise<{ reference: string }> {
    if (cardNumber === DECLINED_CARD) {
      throw new PaymentDeclinedError('card declined by issuer');
    }

    void total; // real implementation would pass this to the payment processor
    return { reference: randomUUID() };
  }

  async getStatus(
    _reference: string,
  ): Promise<'succeeded' | 'failed' | 'unknown'> {
    return 'succeeded';
  }
}

export const PaymentGateway = new _PaymentGateway();
