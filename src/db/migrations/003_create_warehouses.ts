import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWarehouses1749513603000 implements MigrationInterface {
  name = 'CreateWarehouses1749513603000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE warehouses (
        id        SERIAL           PRIMARY KEY,
        name      TEXT             NOT NULL,
        address   TEXT             NOT NULL,
        latitude  DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE warehouses`);
  }
}
