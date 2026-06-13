import { EntityManager } from 'typeorm';
import { env } from '../../config/env';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { InsufficientInventoryError } from '../../util/errors';
import { logger } from '../../util/logger';
import { DistributedLockService } from '../DistributedLockService';

const LOCK_TTL_MS = 5_000;

interface ReservationItem {
  productId: number;
  quantity: number;
}

class _ReservationService {
  async createReservations({
    warehouseId,
    reservationItem,
    orderId,
  }: {
    warehouseId: number;
    reservationItem: ReservationItem[];
    orderId: number;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + env.RESERVATION_EXPIRY_MINUTES * 60 * 1_000);

    // Ascending productId order prevents deadlocks when two concurrent orders
    // touch the same products in opposite order.
    const sortedReservationItems = [...reservationItem].sort((a, b) => a.productId - b.productId);

    for (const reservationItem of sortedReservationItems) {
      const lockKey = `inv-lock:${warehouseId}:${reservationItem.productId}`;
      const token = await DistributedLockService.acquire({ key: lockKey, ttlMs: LOCK_TTL_MS });

      if (!token) {
        throw new Error(`Failed to acquire inventory lock for product ${reservationItem.productId}`);
      }

      try {
        // Both the check and the insert happen inside the lock — this is what prevents oversell.
        const availableInventory = await InventoryRepository.getAvailable({
          warehouseId,
          productId: reservationItem.productId,
        });

        if (!availableInventory || availableInventory.available < reservationItem.quantity) {
          throw new InsufficientInventoryError();
        }

        await ReservationRepository.insert({
          inventoryId: availableInventory.inventoryId,
          orderId,
          quantity: reservationItem.quantity,
          expiresAt,
        });

        logger.info({ warehouseId, productId: reservationItem.productId, orderId }, 'reservation created');
      } finally {
        // Guaranteed release — even if the availableInventory check or insert throws.
        await DistributedLockService.release({ key: lockKey, token });
      }
    }
  }

  async confirmReservations({ orderId, manager }: { orderId: number; manager?: EntityManager }): Promise<void> {
    await ReservationRepository.confirmByOrderId({ orderId, manager });
    logger.info({ orderId }, 'reservations confirmed');
  }

  async releaseReservations({ orderId, manager }: { orderId: number; manager?: EntityManager }): Promise<void> {
    await ReservationRepository.releaseByOrderId({ orderId, manager });
    logger.info({ orderId }, 'reservations released');
  }
}

export const ReservationService = new _ReservationService();
