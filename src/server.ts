import 'reflect-metadata';
import { AppDataSource } from './db/dataSource';
import { WarehouseRepository } from './repositories/WarehouseRepository';
import { ProductRepository } from './repositories/ProductRepository';
import { InventoryRepository } from './repositories/InventoryRepository';

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
  console.log('Done.');
}

verifyRepositories().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
