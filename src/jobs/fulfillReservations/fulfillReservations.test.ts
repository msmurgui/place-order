import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/ReservationRepository', () => ({
  ReservationRepository: { findConfirmedGrouped: vi.fn() },
}));
vi.mock('../../repositories/InventoryRepository', () => ({
  InventoryRepository: { decrementQuantity: vi.fn() },
}));
// transaction(cb) just runs the callback with a stand-in manager that records its queries.
const fakeManager = { query: vi.fn() } as unknown as EntityManager;
vi.mock('../../db/dataSource', () => ({
  AppDataSource: {
    transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(fakeManager)),
  },
}));

import { AppDataSource } from '../../db/dataSource';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { logger } from '../../util/logger';
import { runFulfillReservations } from './fulfillReservations';

beforeEach(() => {
  vi.mocked(ReservationRepository.findConfirmedGrouped).mockResolvedValue([]);
  vi.mocked(InventoryRepository.decrementQuantity).mockResolvedValue(undefined);
  vi.mocked(fakeManager.query).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runFulfillReservations', () => {
  it('decrements stock and releases the confirmed rows for each inventory group', async () => {
    vi.mocked(ReservationRepository.findConfirmedGrouped).mockResolvedValue([
      { inventoryId: 10, totalQuantity: 5, reservationIds: [1, 2] },
      { inventoryId: 20, totalQuantity: 3, reservationIds: [3] },
    ]);

    const result = await runFulfillReservations();

    expect(AppDataSource.transaction).toHaveBeenCalledTimes(2);
    expect(InventoryRepository.decrementQuantity).toHaveBeenCalledWith({
      inventoryId: 10,
      amount: 5,
      manager: fakeManager,
    });
    expect(InventoryRepository.decrementQuantity).toHaveBeenCalledWith({
      inventoryId: 20,
      amount: 3,
      manager: fakeManager,
    });
    // Releases exactly the summed rows, guarded on status = 'confirmed'.
    expect(fakeManager.query).toHaveBeenCalledWith(expect.stringContaining("status = 'released'"), [[1, 2]]);
    expect(fakeManager.query).toHaveBeenCalledWith(expect.stringContaining("status = 'released'"), [[3]]);
    expect(result).toEqual({ inventoriesDecremented: 2, reservationsReleased: 3 });
    expect(logger.info).toHaveBeenCalled();
  });

  it('is a no-op when there are no confirmed reservations', async () => {
    const result = await runFulfillReservations();

    expect(AppDataSource.transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ inventoriesDecremented: 0, reservationsReleased: 0 });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
