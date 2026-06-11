import 'reflect-metadata';
import { AppDataSource } from './db/dataSource';
import { redisClient } from './redis';
import { WarehouseRepository } from './repositories/WarehouseRepository';
import { ProductRepository } from './repositories/ProductRepository';
import { InventoryRepository } from './repositories/InventoryRepository';
import { DistributedLockService } from './services/DistributedLockService';

async function verifyRepositories(): Promise<void> {
  await AppDataSource.initialize();
  console.log('Database connected.');

  const warehouses = await WarehouseRepository.findAll();
  console.log('Warehouses:', JSON.stringify(warehouses, null, 2));

  const products = await ProductRepository.findByIds([1, 2, 3]);
  console.log('Products:', JSON.stringify(products, null, 2));

  const available = await InventoryRepository.getAvailable({ warehouseId: 1, productId: 1 });
  console.log('Available stock (warehouse 1, product 1):', available);

  await AppDataSource.destroy();
}

async function verifyDistributedLock(): Promise<void> {
  const key = 'test:lock:product-1';

  const token = await DistributedLockService.acquire({ key, ttlMs: 5000 });
  console.log('Acquired lock:', token !== null);                          // true

  const duplicate = await DistributedLockService.acquire({ key, ttlMs: 5000 });
  console.log('Second acquire blocked (expected null):', duplicate);      // null

  await DistributedLockService.release({ key, token: token! });

  const reacquired = await DistributedLockService.acquire({ key, ttlMs: 5000 });
  console.log('Re-acquired after release:', reacquired !== null);         // true
  await DistributedLockService.release({ key, token: reacquired! });
}

async function main(): Promise<void> {
  console.log('\n--- Repositories ---');
  await verifyRepositories();

  console.log('\n--- Distributed Lock ---');
  await verifyDistributedLock();

  await redisClient.quit();
  console.log('\nDone.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
