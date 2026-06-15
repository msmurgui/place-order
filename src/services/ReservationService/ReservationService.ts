import { EntityManager } from 'typeorm';
import { env } from '../../config/env';
import { AppDataSource } from '../../db/dataSource';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { InsufficientInventoryError } from '../../util/errors';
import { logger } from '../../util/logger';

interface ReservationItem {
  productId: number;
  quantity: number;
}

class _ReservationService {
  /**
   * Creates reservations for the given warehouse and items, grouped by reservationGroupId.
   * Reservations will expire after a configured amount of time if not confirmed or released.
   *
   * @param params
   * @param params.warehouseId The ID of the warehouse to reserve inventory in.
   * @param params.reservationItems The items to reserve, with productId and quantity.
   * @param params.reservationGroupId A unique ID to group these reservations together (not order_id).
   * @returns Resolves when reservations are successfully created; rejects with InsufficientInventoryError if any item cannot be reserved.
   */
  async createReservations({
    warehouseId,
    reservationItems,
    reservationGroupId,
  }: {
    warehouseId: number;
    reservationItems: ReservationItem[];
    reservationGroupId: string;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + env.RESERVATION_EXPIRY_MINUTES * 60 * 1_000);

    // Ascending productId order prevents deadlocks when two concurrent orders
    // touch the same products in opposite order.
    const sortedReservationItems = [...reservationItems].sort((a, b) => a.productId - b.productId);

    for (const reservationItem of sortedReservationItems) {
      await AppDataSource.transaction(async (manager) => {
        // Serialize concurrent orders for this (warehouseId, productId) to prevent overselling.
        // The lock is held only for the availability check + reservation insert below, and released
        // when this transaction commits/rolls back.
        await InventoryRepository.lockForReservation({
          warehouseId,
          productId: reservationItem.productId,
          manager,
        });

        // Both the check and the insert happen inside the lock — this is what prevents oversell.
        const availableInventory = await InventoryRepository.getAvailable({
          warehouseId,
          productId: reservationItem.productId,
          manager,
        });

        if (!availableInventory || availableInventory.available < reservationItem.quantity) {
          throw new InsufficientInventoryError();
        }

        await ReservationRepository.insert(
          {
            inventoryId: availableInventory.inventoryId,
            reservationGroupId,
            quantity: reservationItem.quantity,
            expiresAt,
          },
          manager
        );

        logger.info(
          { warehouseId, productId: reservationItem.productId, reservationGroupId },
          'reservation created'
        );
      });
    }
  }

  async confirmReservations({
    reservationGroupId,
    manager,
  }: {
    reservationGroupId: string;
    manager?: EntityManager;
  }): Promise<void> {
    await ReservationRepository.confirmByGroupId({ reservationGroupId, manager });
    logger.info({ reservationGroupId }, 'reservations confirmed');
  }

  async releaseReservations({
    reservationGroupId,
    manager,
  }: {
    reservationGroupId: string;
    manager?: EntityManager;
  }): Promise<void> {
    await ReservationRepository.releaseByGroupId({ reservationGroupId, manager });
    logger.info({ reservationGroupId }, 'reservations released');
  }
}

export const ReservationService = new _ReservationService();
