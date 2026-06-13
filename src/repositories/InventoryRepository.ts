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

  async getAvailable({
    warehouseId,
    productId,
  }: {
    warehouseId: number;
    productId: number;
  }): Promise<AvailableInventory | null> {
    const rows = await this.dataSource.query<{ inventory_id: string; available: string }[]>(
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
}

export const InventoryRepository = new _InventoryRepository();
