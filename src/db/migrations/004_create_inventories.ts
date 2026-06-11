import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventories1749513604000 implements MigrationInterface {
  name = 'CreateInventories1749513604000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventories (
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        product_id   INTEGER NOT NULL REFERENCES products(id),
        quantity     INTEGER NOT NULL CHECK (quantity >= 0),
        PRIMARY KEY (warehouse_id, product_id)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE inventories`);
  }
}
