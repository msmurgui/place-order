import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryIdToReservations1749513609000 implements MigrationInterface {
  name = 'AddInventoryIdToReservations1749513609000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inventory_reservations
        ADD COLUMN inventory_id INTEGER NOT NULL REFERENCES inventories(id)
    `);

    // CASCADE drops the FK constraints on warehouse_id and product_id automatically
    await queryRunner.query(`ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS warehouse_id CASCADE`);
    await queryRunner.query(`ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS product_id CASCADE`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_reservations_availability`);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_availability
        ON inventory_reservations (inventory_id, status, expires_at)
        WHERE status = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_reservations_availability`);

    await queryRunner.query(`
      ALTER TABLE inventory_reservations
        ADD COLUMN warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        ADD COLUMN product_id   INTEGER NOT NULL REFERENCES products(id)
    `);
    await queryRunner.query(`ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS inventory_id CASCADE`);

    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_availability
        ON inventory_reservations (warehouse_id, product_id, status, expires_at)
        WHERE status = 'active'
    `);
  }
}
