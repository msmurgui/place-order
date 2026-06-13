import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenAvailabilityIndex1749513610000 implements MigrationInterface {
  name = 'WidenAvailabilityIndex1749513610000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The availability query now subtracts both 'active' and 'confirmed' reservations,
    // so the partial index must cover both statuses. A partial index predicate cannot
    // be altered in place — drop and recreate under the same name.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_reservations_availability`);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_availability
        ON inventory_reservations (inventory_id, status, expires_at)
        WHERE status IN ('active', 'confirmed')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_reservations_availability`);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_availability
        ON inventory_reservations (inventory_id, status, expires_at)
        WHERE status = 'active'
    `);
  }
}
