import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryReservations1749513607000 implements MigrationInterface {
  name = 'CreateInventoryReservations1749513607000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventory_reservations (
        id           SERIAL      PRIMARY KEY,
        warehouse_id INTEGER     NOT NULL REFERENCES warehouses(id),
        product_id   INTEGER     NOT NULL REFERENCES products(id),
        order_id     INTEGER     NOT NULL REFERENCES orders(id),
        quantity     INTEGER     NOT NULL,
        status       TEXT        NOT NULL CHECK (status IN ('active', 'confirmed', 'released')),
        expires_at   TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Index for checking available stock: filters only active reservations
    // to keep the index small and fast. Confirmed and released reservations
    // are automatically excluded from this index.
    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_availability
      ON inventory_reservations (warehouse_id, product_id, status, expires_at)
      WHERE status = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_inventory_reservations_availability`);
    await queryRunner.query(`DROP TABLE inventory_reservations`);
  }
}
