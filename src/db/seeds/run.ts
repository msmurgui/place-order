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

    // The first three products (ids 1–3) back demo.ts and load-test.ts — do not reorder them.
    // The last two (ids 4 & 5) are reviewer-facing demo products with deterministic stock:
    //   - DEMO-OOS-001 (id 4): zero stock everywhere — exercises the out-of-stock (409) path.
    //   - DEMO-INF-001 (id 5): effectively unlimited stock — always fulfillable.
    await AppDataSource.query(`
      INSERT INTO products (name, sku, price, description, tax_code) VALUES
        ('Organic Apples',      'APPL-ORG-1KG', 5.00,  'Fresh organic apples, 1 kg bag',        'GROCERY'),
        ('Wireless Headphones', 'ELEC-WH-001',  80.00, 'Over-ear noise-cancelling headphones',  'ELECTRONICS'),
        ('USB Keyboard',        'COMP-KB-001',  45.00, 'Mechanical USB keyboard',               'STANDARD'),
        ('Sold-Out Collectible','DEMO-OOS-001', 25.00, 'Demo: intentionally out of stock everywhere (tests the 409 path)', 'STANDARD'),
        ('Digital Gift Card',   'DEMO-INF-001', 50.00, 'Demo: effectively unlimited stock everywhere (always fulfillable)', 'STANDARD')
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
        ('Los Angeles Warehouse', 'COMP-KB-001',   '60'),
        -- Demo products: zero everywhere (out-of-stock) and ~1B (effectively infinite).
        ('Seattle Warehouse',     'DEMO-OOS-001',          '0'),
        ('Los Angeles Warehouse', 'DEMO-OOS-001',          '0'),
        ('Seattle Warehouse',     'DEMO-INF-001', '1000000000'),
        ('Los Angeles Warehouse', 'DEMO-INF-001', '1000000000')
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
