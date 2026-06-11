import 'reflect-metadata';
import { AppDataSource } from '../dataSource';

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await AppDataSource.query(`
      INSERT INTO customers (name, email) VALUES
        ('Alice Johnson', 'alice@example.com')
      ON CONFLICT (email) DO NOTHING
    `);

    await AppDataSource.query(`
      INSERT INTO products (name, sku, price, description, tax_code) VALUES
        ('Organic Apples',      'APPL-ORG-1KG', 5.00,  'Fresh organic apples, 1 kg bag',        'GROCERY'),
        ('Wireless Headphones', 'ELEC-WH-001',  80.00, 'Over-ear noise-cancelling headphones',  'ELECTRONICS'),
        ('USB Keyboard',        'COMP-KB-001',  45.00, 'Mechanical USB keyboard',               'STANDARD')
      ON CONFLICT (sku) DO NOTHING
    `);

    // No unique constraint on warehouses — guard with WHERE NOT EXISTS so the seed is idempotent
    await AppDataSource.query(`
      INSERT INTO warehouses (name, address, latitude, longitude)
      SELECT v.name, v.address, v.lat::double precision, v.lng::double precision
      FROM (VALUES
        ('Seattle Warehouse',     '1234 Harbor Ave, Seattle, WA 98126',       '47.6062', '-122.3321'),
        ('Los Angeles Warehouse', '5678 Commerce Dr, Los Angeles, CA 90058',  '34.0522', '-118.2437')
      ) AS v(name, address, lat, lng)
      WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouses.name = v.name)
    `);

    // Seattle: no keyboards (0) — forces LA warehouse for keyboard orders
    // Seattle: 200 apples — covers the 100-concurrent-order load test
    await AppDataSource.query(`
      INSERT INTO inventories (warehouse_id, product_id, quantity)
      SELECT w.id, p.id, v.qty::integer
      FROM (VALUES
        ('Seattle Warehouse',     'APPL-ORG-1KG', '200'),
        ('Seattle Warehouse',     'ELEC-WH-001',   '50'),
        ('Seattle Warehouse',     'COMP-KB-001',    '0'),
        ('Los Angeles Warehouse', 'APPL-ORG-1KG', '100'),
        ('Los Angeles Warehouse', 'ELEC-WH-001',   '30'),
        ('Los Angeles Warehouse', 'COMP-KB-001',   '60')
      ) AS v(warehouse_name, sku, qty)
      JOIN warehouses w ON w.name = v.warehouse_name
      JOIN products   p ON p.sku  = v.sku
      ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity
    `);

    console.log('Seed completed.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
