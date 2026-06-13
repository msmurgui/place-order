import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientInventoryError } from '../../util/errors';

vi.mock('../../config/env', () => ({ env: { RESERVATION_EXPIRY_MINUTES: 10 } }));
vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/InventoryRepository', () => ({ InventoryRepository: { getAvailable: vi.fn() } }));
vi.mock('../../repositories/ReservationRepository', () => ({
  ReservationRepository: { insert: vi.fn(), confirmByGroupId: vi.fn(), releaseByGroupId: vi.fn() },
}));
vi.mock('../DistributedLockService', () => ({ DistributedLockService: { acquire: vi.fn(), release: vi.fn() } }));

import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { DistributedLockService } from '../DistributedLockService';
import { ReservationService } from './ReservationService';

const warehouseId = 1;
const reservationGroupId = 'group-abc';

beforeEach(() => {
  vi.mocked(DistributedLockService.acquire).mockResolvedValue('lock-token');
  vi.mocked(DistributedLockService.release).mockResolvedValue(undefined);
  vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 10, available: 5 });
  vi.mocked(ReservationRepository.insert).mockResolvedValue(undefined as never);
  vi.mocked(ReservationRepository.confirmByGroupId).mockResolvedValue(undefined);
  vi.mocked(ReservationRepository.releaseByGroupId).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createReservations', () => {
  it('acquires lock, checks availability, and inserts reservation', async () => {
    await ReservationService.createReservations({
      warehouseId,
      reservationItem: [{ productId: 1, quantity: 2 }],
      reservationGroupId,
    });

    expect(DistributedLockService.acquire).toHaveBeenCalledWith({ key: 'inv-lock:1:1', ttlMs: 5_000 });
    expect(InventoryRepository.getAvailable).toHaveBeenCalledWith({ warehouseId, productId: 1 });
    expect(ReservationRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryId: 10, reservationGroupId, quantity: 2 })
    );
    expect(DistributedLockService.release).toHaveBeenCalledWith({ key: 'inv-lock:1:1', token: 'lock-token' });
  });

  it('acquires locks in ascending productId order to prevent deadlocks', async () => {
    await ReservationService.createReservations({
      warehouseId,
      reservationItem: [
        { productId: 3, quantity: 1 },
        { productId: 1, quantity: 1 },
      ],
      reservationGroupId,
    });

    const acquireCalls = vi.mocked(DistributedLockService.acquire).mock.calls;
    expect(acquireCalls[0][0].key).toBe('inv-lock:1:1');
    expect(acquireCalls[1][0].key).toBe('inv-lock:1:3');
  });

  it('throws InsufficientInventoryError when available stock is too low', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 10, available: 1 });

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItem: [{ productId: 1, quantity: 5 }],
        reservationGroupId,
      })
    ).rejects.toThrow(InsufficientInventoryError);
  });

  it('throws InsufficientInventoryError when no inventory record exists for the product', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockResolvedValue(null);

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItem: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow(InsufficientInventoryError);
  });

  it('throws when lock cannot be acquired', async () => {
    vi.mocked(DistributedLockService.acquire).mockResolvedValue(null);

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItem: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow('Failed to acquire inventory lock');

    expect(InventoryRepository.getAvailable).not.toHaveBeenCalled();
  });

  it('releases lock even when insert throws', async () => {
    vi.mocked(ReservationRepository.insert).mockRejectedValue(new Error('DB error'));

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItem: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow('DB error');

    expect(DistributedLockService.release).toHaveBeenCalledWith({ key: 'inv-lock:1:1', token: 'lock-token' });
  });

  it('releases lock even when availability check throws', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockRejectedValue(new Error('DB error'));

    await expect(
      ReservationService.createReservations({
        warehouseId,
        reservationItem: [{ productId: 1, quantity: 1 }],
        reservationGroupId,
      })
    ).rejects.toThrow('DB error');

    expect(DistributedLockService.release).toHaveBeenCalled();
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
