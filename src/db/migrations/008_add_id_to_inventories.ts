import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdToInventories1749513608000 implements MigrationInterface {
  name = 'AddIdToInventories1749513608000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventories ADD COLUMN id SERIAL`);
    await queryRunner.query(`ALTER TABLE inventories DROP CONSTRAINT inventories_pkey`);
    await queryRunner.query(`
      ALTER TABLE inventories
        ADD CONSTRAINT inventories_warehouse_product_unique UNIQUE (warehouse_id, product_id)
    `);
    await queryRunner.query(`ALTER TABLE inventories ADD PRIMARY KEY (id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventories DROP CONSTRAINT inventories_pkey`);
    await queryRunner.query(`ALTER TABLE inventories DROP CONSTRAINT inventories_warehouse_product_unique`);
    await queryRunner.query(`ALTER TABLE inventories ADD PRIMARY KEY (warehouse_id, product_id)`);
    await queryRunner.query(`ALTER TABLE inventories DROP COLUMN id`);
  }
}
