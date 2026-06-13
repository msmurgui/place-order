import 'reflect-metadata';
import { AppDataSource } from '../dataSource';

async function truncate(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await AppDataSource.query(`
      TRUNCATE customers, products, warehouses, inventories, orders, order_items, inventory_reservations
      RESTART IDENTITY CASCADE
    `);
    console.log('All tables truncated.');
  } finally {
    await AppDataSource.destroy();
  }
}

truncate().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
