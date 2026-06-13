import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/ReservationRepository', () => ({
  ReservationRepository: { releaseExpiredActive: vi.fn() },
}));
vi.mock('../../repositories/OrderRepository', () => ({
  OrderRepository: { failPendingByGroupIds: vi.fn() },
}));
// transaction(cb) just runs the callback with a stand-in manager.
const fakeManager = {} as EntityManager;
vi.mock('../../db/dataSource', () => ({
  AppDataSource: {
    transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(fakeManager)),
  },
}));

import { ReservationRepository } from '../../repositories/ReservationRepository';
import { OrderRepository } from '../../repositories/OrderRepository';
import { logger } from '../../util/logger';
import { runExpireReservations } from './expireReservations';

beforeEach(() => {
  vi.mocked(ReservationRepository.releaseExpiredActive).mockResolvedValue([]);
  vi.mocked(OrderRepository.failPendingByGroupIds).mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runExpireReservations', () => {
  it('releases expired reservations and fails the deduped pending orders', async () => {
    // Two reservations share group g1, one is g2 → two distinct groups.
    vi.mocked(ReservationRepository.releaseExpiredActive).mockResolvedValue(['g1', 'g1', 'g2']);
    vi.mocked(OrderRepository.failPendingByGroupIds).mockResolvedValue(2);

    const result = await runExpireReservations();

    expect(OrderRepository.failPendingByGroupIds).toHaveBeenCalledWith({
      groupIds: ['g1', 'g2'],
      manager: fakeManager,
    });
    expect(result).toEqual({ releasedReservations: 3, failedOrders: 2 });
    expect(logger.info).toHaveBeenCalled();
  });

  it('is a no-op when nothing has expired', async () => {
    const result = await runExpireReservations();

    expect(result).toEqual({ releasedReservations: 0, failedOrders: 0 });
    // Nothing released → no orders to fail, no log line emitted.
    expect(OrderRepository.failPendingByGroupIds).toHaveBeenCalledWith({ groupIds: [], manager: fakeManager });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
