import { MigrationInterface, QueryRunner } from 'typeorm';

export class IntroduceReservationGroupId1749513611000 implements MigrationInterface {
  name = 'IntroduceReservationGroupId1749513611000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Reservations are now grouped by a server-generated UUID created before the order
    // exists, allowing inventory to be reserved ahead of the order write. The order
    // carries the same reservation_group_id for the reverse lookup, replacing order_id
    // on the reservation table. Both tables change together so the schema is never in a
    // half-migrated state.
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN reservation_group_id UUID NOT NULL UNIQUE
    `);

    await queryRunner.query(`
      ALTER TABLE inventory_reservations
        ADD COLUMN reservation_group_id UUID NOT NULL
    `);

    // CASCADE drops the FK constraint to orders(id) automatically.
    await queryRunner.query(`ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS order_id CASCADE`);

    // Supports confirm/release lookups, which now key on reservation_group_id.
    await queryRunner.query(`
      CREATE INDEX idx_inventory_reservations_group
        ON inventory_reservations (reservation_group_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_reservations_group`);
    await queryRunner.query(`ALTER TABLE inventory_reservations DROP COLUMN IF EXISTS reservation_group_id`);
    await queryRunner.query(`
      ALTER TABLE inventory_reservations
        ADD COLUMN order_id INTEGER NOT NULL REFERENCES orders(id)
    `);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN reservation_group_id`);
  }
}
