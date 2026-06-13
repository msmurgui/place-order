import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { InsufficientInventoryError } from '../../util/errors';

vi.mock('../../config/env', () => ({ env: { RESERVATION_EXPIRY_MINUTES: 10 } }));
vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/InventoryRepository', () => ({
  InventoryRepository: { getAvailable: vi.fn(), lockForReservation: vi.fn() },
}));
vi.mock('../../repositories/ReservationRepository', () => ({
  ReservationRepository: { insert: vi.fn(), confirmByGroupId: vi.fn(), releaseByGroupId: vi.fn() },
}));

// Fake transaction manager. AppDataSource.transaction simply invokes the callback with it,
// so each createReservations item runs against this manager (no real DB connection).
const fakeManager = { query: vi.fn() } as unknown as EntityManager;
vi.mock('../../db/dataSource', () => ({
  AppDataSource: {
    transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(fakeManager)),
  },
}));

import { AppDataSource } from '../../db/dataSource';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { ReservationService } from './ReservationService';

const warehouseId = 1;
const reservationGroupId = 'group-abc';

beforeEach(() => {
  vi.mocked(InventoryRepository.lockForReservation).mockResolvedValue(undefined);
  vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 10, available: 5 });
  vi.mocked(ReservationRepository.insert).mockResolvedValue(undefined as never);
  vi.mocked(ReservationRepository.confirmByGroupId).mockResolvedValue(undefined);
  vi.mocked(ReservationRepository.releaseByGroupId).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createReservations', () => {
  it('takes an advisory lock, checks availability, and inserts the reservation in one transaction', async () => {
    await ReservationService.createReservations({
      warehouseId,
      reservationItems: [{ productId: 1, quantity: 2 }],
      reservationGroupId,
    });

    expect(AppDataSource.transaction).toHaveBeenCalledTimes(1);
    expect(InventoryRepository.lockForReservation).toHaveBeenCalledWith({ warehouseId, productId: 1, manager: fakeManager });
    expect(InventoryRepository.getAvailable).toHaveBeenCalledWith({ warehouseId, productId: 1, manager: fakeManager });
    expect(ReservationRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryId: 10, reservationGroupId, quantity: 2 }),
      fakeManager
    );
  });

  it('locks the availability check before reading it', async () => {
    const order: string[] = [];
    vi.mocked(InventoryRepository.lockForReservation).mockImplementation(async () => {
      order.push('lock');
    });
    vi.mocked(InventoryRepository.getAvailable).mockImplementation(async () => {
      order.push('check');
      return { inventoryId: 10, available: 5 };
    });

    await ReservationService.createReservations({
      warehouseId,
      reservationItems: [{ productId: 1, quantity: 1 }],
      reservationGroupId,
    });

    expect(order).toEqual(['lock', 'check']);
  });

  it('acquires locks in ascending productId order to prevent deadlocks', async () => {
    await ReservationService.createReservations({
      warehouseId,
      reservationItems: [
        { productId: 3, quantity: 1 },
        { productId: 1, quantity: 1 },
      ],
      reservationGroupId,
    });

    const lockCalls = vi.mocked(InventoryRepository.lockForReservation).mock.calls;
    expect(lockCalls[0][0].productId).toBe(1);
    expect(lockCalls[1][0].productId).toBe(3);
  });

  it('throws InsufficientInventoryError when available stock is too low', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 10, available: 1 });

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItems: [{ productId: 1, quantity: 5 }],
        reservationGroupId,
      })
    ).rejects.toThrow(InsufficientInventoryError);
  });

  it('throws InsufficientInventoryError when no inventory record exists for the product', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockResolvedValue(null);

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItems: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow(InsufficientInventoryError);
  });

  it('propagates errors so the transaction rolls back (advisory lock released on rollback)', async () => {
    vi.mocked(ReservationRepository.insert).mockRejectedValue(new Error('DB error'));

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItems: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow('DB error');
  });
});

describe('confirmReservations', () => {
  it('delegates to ReservationRepository', async () => {
    await ReservationService.confirmReservations({ reservationGroupId });
    expect(ReservationRepository.confirmByGroupId).toHaveBeenCalledWith({ reservationGroupId, manager: undefined });
  });
});

describe('releaseReservations', () => {
  it('delegates to ReservationRepository', async () => {
    await ReservationService.releaseReservations({ reservationGroupId });
    expect(ReservationRepository.releaseByGroupId).toHaveBeenCalledWith({ reservationGroupId, manager: undefined });
  });
});
