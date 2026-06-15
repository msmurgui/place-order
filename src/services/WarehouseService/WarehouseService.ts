import { Warehouse } from '../../entities/Warehouse';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { WarehouseRepository } from '../../repositories/WarehouseRepository';
import { getDistanceBetweenCoordinates } from '../../util/getDistanceBetweenCoordinates';
import { NoWarehouseAvailableError } from '../../util/errors';
import { GeocodeService } from '../GeocodeService';

interface OrderItem {
  productId: number;
  quantity: number;
}

class _WarehouseService {
  /**
   * Finds the closest warehouse that can fulfill the given order items.
   *
   * @param params
   * @param params.orderItems The items to order, with productId and quantity.
   * @param params.shippingAddress The shipping address to calculate distance from.
   * @returns The closest warehouse that can fulfill the order.
   */
  async findClosestToFulfill({
    orderItems,
    shippingAddress,
  }: {
    orderItems: OrderItem[];
    shippingAddress: string;
  }): Promise<Warehouse> {
    const [warehouses, shippingCoords] = await Promise.all([
      WarehouseRepository.findAll(), // TODO: Analyze if this query could be bounded - larger warehouses dataset might cause performance issues
      GeocodeService.geocode(shippingAddress),
    ]);

    const eligibleWarehouses: {
      warehouse: Warehouse;
      distanceToShippingAddress: number;
    }[] = [];

    // For each warehouse, check if it can fulfill the order
    // and calculate distance to shipping address
    //
    // Note: This can be optimized by parallelizing inventory checks, but
    // could also lead to increased load on the database if there are many
    // warehouses and order items. TODO: Analyze if worth the parallelization.
    for (const warehouse of warehouses) {
      const availability = await Promise.all(
        orderItems.map((item) =>
          InventoryRepository.getAvailable({ warehouseId: warehouse.id, productId: item.productId })
        )
      );

      const canFulfill = availability.every(
        (result, i) => result !== null && result.available >= orderItems[i].quantity
      );

      if (canFulfill) {
        const distanceToShippingAddress = getDistanceBetweenCoordinates({
          from: shippingCoords,
          to: { lat: warehouse.latitude, lng: warehouse.longitude },
        });

        eligibleWarehouses.push({ warehouse, distanceToShippingAddress });
      }
    }

    if (eligibleWarehouses.length === 0) throw new NoWarehouseAvailableError();

    eligibleWarehouses.sort((a, b) => a.distanceToShippingAddress - b.distanceToShippingAddress);

    return eligibleWarehouses[0].warehouse;
  }
}

export const WarehouseService = new _WarehouseService();
