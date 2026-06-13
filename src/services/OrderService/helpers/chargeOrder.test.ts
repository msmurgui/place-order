import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDeclinedError } from '../../../gateways/PaymentGateway';

vi.mock('../../../gateways/PaymentGateway', async (importActual) => {
  const actual = await importActual<typeof import('../../../gateways/PaymentGateway')>();
  return { ...actual, PaymentGateway: { charge: vi.fn(), getStatus: vi.fn() } };
});
vi.mock('../../../middleware/circuitBreaker', () => ({ assertCircuitClosed: vi.fn() }));

import { PaymentGateway } from '../../../gateways/PaymentGateway';
import { assertCircuitClosed } from '../../../middleware/circuitBreaker';
import { chargeOrder } from './chargeOrder';

const args = { orderId: 1, orderItemIds: [1, 2], total: 110, cardNumber: '4111111111111111' };

beforeEach(() => {
  vi.mocked(assertCircuitClosed).mockResolvedValue(undefined);
  vi.mocked(PaymentGateway.charge).mockResolvedValue({ reference: 'pay-1' });
  vi.mocked(PaymentGateway.getStatus).mockResolvedValue('succeeded');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('chargeOrder', () => {
  it('returns the reference and status when the charge settles', async () => {
    const result = await chargeOrder(args);
    expect(result).toEqual({ reference: 'pay-1', paymentStatus: 'succeeded' });
  });

  it('returns an unknown status as pending (caller defers to reconciliation)', async () => {
    vi.mocked(PaymentGateway.getStatus).mockResolvedValue('unknown');
    const result = await chargeOrder(args);
    expect(result).toEqual({ reference: 'pay-1', paymentStatus: 'unknown' });
  });

  it('throws PaymentDeclinedError when the gateway reports the charge failed', async () => {
    vi.mocked(PaymentGateway.getStatus).mockResolvedValue('failed');
    await expect(chargeOrder(args)).rejects.toThrow(PaymentDeclinedError);
  });

  it('throws (does not catch) when the charge call itself is declined', async () => {
    vi.mocked(PaymentGateway.charge).mockRejectedValue(new PaymentDeclinedError('card declined'));
    await expect(chargeOrder(args)).rejects.toThrow(PaymentDeclinedError);
  });
});
