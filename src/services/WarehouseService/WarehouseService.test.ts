import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoWarehouseAvailableError } from '../../util/errors';

vi.mock('../../repositories/InventoryRepository', () => ({ InventoryRepository: { getAvailable: vi.fn() } }));
vi.mock('../../repositories/WarehouseRepository', () => ({ WarehouseRepository: { findAll: vi.fn() } }));
vi.mock('../GeocodeService', () => ({ GeocodeService: { geocode: vi.fn() } }));

import type { Warehouse } from '../../entities/Warehouse';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { WarehouseRepository } from '../../repositories/WarehouseRepository';
import { GeocodeService } from '../GeocodeService';
import { WarehouseService } from './WarehouseService';

const shippingAddress = '123 Main St, Seattle WA';
const shippingCoords = { lat: 47.6062, lng: -122.3321 };

// warehouseNear is ~15km from shippingCoords; warehouseFar is ~1900km away (Los Angeles)
const warehouseNear = { id: 1, name: 'Near', address: 'Near St', latitude: 47.5, longitude: -122.3 } as Warehouse;
const warehouseFar = { id: 2, name: 'Far', address: 'Far St', latitude: 34.0522, longitude: -118.2437 } as Warehouse;

beforeEach(() => {
  vi.mocked(GeocodeService.geocode).mockResolvedValue(shippingCoords);
  vi.mocked(WarehouseRepository.findAll).mockResolvedValue([warehouseNear, warehouseFar]);
  vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 1, available: 10 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('findClosestToFulfill', () => {
  it('returns the closest eligible warehouse', async () => {
    const result = await WarehouseService.findClosestToFulfill({
      orderItems: [{ productId: 1, quantity: 1 }],
      shippingAddress,
    });

    expect(result).toBe(warehouseNear);
  });

  it('returns closest warehouse regardless of DB fetch order', async () => {
    vi.mocked(WarehouseRepository.findAll).mockResolvedValue([warehouseFar, warehouseNear]);

    const result = await WarehouseService.findClosestToFulfill({
      orderItems: [{ productId: 1, quantity: 1 }],
      shippingAddress,
    });

    expect(result).toBe(warehouseNear);
  });

  it('skips warehouses with insufficient stock', async () => {
    vi.mocked(InventoryRepository.getAvailable)
      .mockResolvedValueOnce({ inventoryId: 1, available: 0 }) // warehouseNear: not enough
      .mockResolvedValue({ inventoryId: 2, available: 10 });   // warehouseFar: OK

    const result = await WarehouseService.findClosestToFulfill({
      orderItems: [{ productId: 1, quantity: 1 }],
      shippingAddress,
    });

    expect(result).toBe(warehouseFar);
  });

  it('skips warehouses with no inventory record for the product', async () => {
    vi.mocked(InventoryRepository.getAvailable)
      .mockResolvedValueOnce(null)                           // warehouseNear: no record
      .mockResolvedValue({ inventoryId: 2, available: 10 }); // warehouseFar: OK

    const result = await WarehouseService.findClosestToFulfill({
      orderItems: [{ productId: 1, quantity: 1 }],
      shippingAddress,
    });

    expect(result).toBe(warehouseFar);
  });

  it('requires all items to be fulfillable — skips warehouse missing one product', async () => {
    vi.mocked(InventoryRepository.getAvailable)
      .mockResolvedValueOnce({ inventoryId: 1, available: 10 }) // warehouseNear: product 1 OK
      .mockResolvedValueOnce({ inventoryId: 2, available: 0 })  // warehouseNear: product 2 not enough
      .mockResolvedValue({ inventoryId: 3, available: 10 });    // warehouseFar: both OK

    const result = await WarehouseService.findClosestToFulfill({
      orderItems: [
        { productId: 1, quantity: 1 },
        { productId: 2, quantity: 1 },
      ],
      shippingAddress,
    });

    expect(result).toBe(warehouseFar);
  });

  it('throws NoWarehouseAvailableError when no warehouse can fulfill the order', async () => {
    vi.mocked(InventoryRepository.getAvailable).mockResolvedValue({ inventoryId: 1, available: 0 });

    await expect(
      WarehouseService.findClosestToFulfill({
        orderItems: [{ productId: 1, quantity: 1 }],
        shippingAddress,
      })
    ).rejects.toThrow(NoWarehouseAvailableError);
  });

  it('geocodes the address and fetches warehouses', async () => {
    await WarehouseService.findClosestToFulfill({
      orderItems: [{ productId: 1, quantity: 1 }],
      shippingAddress,
    });

    expect(GeocodeService.geocode).toHaveBeenCalledWith(shippingAddress);
    expect(WarehouseRepository.findAll).toHaveBeenCalled();
  });
});
