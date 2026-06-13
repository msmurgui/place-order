import { EntityManager } from 'typeorm';
import { Inventory } from '../entities/Inventory';
import { BaseRepository } from './BaseRepository';

export interface AvailableInventory {
  inventoryId: number;
  available: number;
}

class _InventoryRepository extends BaseRepository<Inventory> {
  constructor() {
    super(Inventory);
  }

  // Accepts an optional manager so the read can run inside the caller's transaction —
  // required when the availability check is guarded by an advisory lock taken in that
  // same transaction (see ReservationService.createReservations).
  async getAvailable({
    warehouseId,
    productId,
    manager,
  }: {
    warehouseId: number;
    productId: number;
    manager?: EntityManager;
  }): Promise<AvailableInventory | null> {
    if (!Number.isInteger(warehouseId) || warehouseId <= 0 ||
        !Number.isInteger(productId)   || productId <= 0) {
      throw new Error(`InventoryRepository.getAvailable: invalid ids warehouseId=${warehouseId} productId=${productId}`);
    }

    const runner = manager ?? this.dataSource;
    const rows = await runner.query<{ inventory_id: string; available: string }[]>(
      `SELECT i.id AS inventory_id,
              i.quantity - COALESCE(SUM(r.quantity), 0) AS available
       FROM inventories i
       LEFT JOIN inventory_reservations r
         ON  r.inventory_id = i.id
         AND (
           (r.status = 'active' AND r.expires_at > NOW())
           OR r.status = 'confirmed'
         )
       WHERE i.warehouse_id = $1
         AND i.product_id   = $2
       GROUP BY i.id, i.quantity`,
      [warehouseId, productId]
    );

    if (rows.length === 0) return null;
    return {
      inventoryId: parseInt(rows[0].inventory_id, 10),
      available: parseInt(rows[0].available, 10),
    };
  }

  // Serializes concurrent reservations for the same (warehouseId, productId) so the availability
  // check and the reservation insert can't interleave and oversell. The advisory lock is held
  // until the caller's transaction commits/rolls back — no TTL, so it can't expire mid-operation.
  // Must run inside a transaction (manager is required); otherwise the lock would release immediately.
  async lockForReservation({
    warehouseId,
    productId,
    manager,
  }: {
    warehouseId: number;
    productId: number;
    manager: EntityManager;
  }): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [warehouseId, productId]);
  }

  // Physically reduces on-hand stock once reservations are fulfilled.
  async decrementQuantity({
    inventoryId,
    amount,
    manager,
  }: {
    inventoryId: number;
    amount: number;
    manager: EntityManager;
  }): Promise<void> {
    await manager.query(`UPDATE inventories SET quantity = quantity - $1 WHERE id = $2`, [
      amount,
      inventoryId,
    ]);
  }
}

export const InventoryRepository = new _InventoryRepository();
