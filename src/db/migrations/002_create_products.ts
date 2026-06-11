import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProducts1749513602000 implements MigrationInterface {
  name = 'CreateProducts1749513602000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE products (
        id          SERIAL         PRIMARY KEY,
        name        TEXT           NOT NULL,
        sku         TEXT           NOT NULL UNIQUE,
        price       NUMERIC(10,2)  NOT NULL,
        description TEXT           NOT NULL,
        tax_code    TEXT           NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE products`);
  }
}
