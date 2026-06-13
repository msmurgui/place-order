import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../../entities/Order';

vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../gateways/PaymentGateway', () => ({ PaymentGateway: { getStatus: vi.fn() } }));
vi.mock('../../repositories/OrderRepository', () => ({ OrderRepository: { findStalePending: vi.fn() } }));
// Mock the OrderService facade so reconcile is isolated from its full dependency graph.
vi.mock('../../services/OrderService/OrderService', () => ({
  OrderService: { applyPaymentResult: vi.fn(), releaseOrderAndReservations: vi.fn() },
}));

import { PaymentGateway } from '../../gateways/PaymentGateway';
import { OrderRepository } from '../../repositories/OrderRepository';
import { OrderService } from '../../services/OrderService/OrderService';
import { logger } from '../../util/logger';
import { runReconcileOrders } from './reconcileOrders';

const order = (id: number, paymentReference: string | null): Order =>
  ({ id, paymentReference, reservationGroupId: `grp-${id}`, status: 'PENDING_PAYMENT' }) as Order;

beforeEach(() => {
  vi.mocked(OrderRepository.findStalePending).mockResolvedValue([]);
  vi.mocked(OrderService.applyPaymentResult).mockResolvedValue({ order: {} as Order });
  vi.mocked(OrderService.releaseOrderAndReservations).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runReconcileOrders', () => {
  it('confirms succeeded, releases failed, and skips unknown / reference-less orders', async () => {
    vi.mocked(OrderRepository.findStalePending).mockResolvedValue([
      order(1, 'ref-1'),
      order(2, 'ref-2'),
      order(3, 'ref-3'),
      order(4, null),
    ]);
    vi.mocked(PaymentGateway.getStatus)
      .mockResolvedValueOnce('succeeded')
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('unknown');

    const result = await runReconcileOrders();

    // Bounded per run so a backlog is drained across runs.
    expect(OrderRepository.findStalePending).toHaveBeenCalledWith({ limit: 100 });
    expect(OrderService.applyPaymentResult).toHaveBeenCalledWith({
      orderId: 1,
      reservationGroupId: 'grp-1',
      paymentReference: 'ref-1',
      paymentStatus: 'succeeded',
    });
    expect(OrderService.releaseOrderAndReservations).toHaveBeenCalledWith({ orderId: 2, reservationGroupId: 'grp-2' });
    // order 4 has no payment reference → never polled
    expect(PaymentGateway.getStatus).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ confirmed: 1, failed: 1, skipped: 2 });
  });

  it('continues past a failing order and counts it as skipped', async () => {
    vi.mocked(OrderRepository.findStalePending).mockResolvedValue([order(1, 'ref-1'), order(2, 'ref-2')]);
    vi.mocked(PaymentGateway.getStatus)
      .mockRejectedValueOnce(new Error('gateway down'))
      .mockResolvedValueOnce('succeeded');

    const result = await runReconcileOrders();

    expect(OrderService.applyPaymentResult).toHaveBeenCalledWith({
      orderId: 2,
      reservationGroupId: 'grp-2',
      paymentReference: 'ref-2',
      paymentStatus: 'succeeded',
    });
    expect(result).toEqual({ confirmed: 1, failed: 0, skipped: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('is a no-op when there are no stale pending orders', async () => {
    const result = await runReconcileOrders();

    expect(PaymentGateway.getStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ confirmed: 0, failed: 0, skipped: 0 });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
