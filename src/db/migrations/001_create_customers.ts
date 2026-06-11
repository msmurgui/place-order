import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomers1749513601000 implements MigrationInterface {
  name = 'CreateCustomers1749513601000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customers (
        id    SERIAL PRIMARY KEY,
        name  TEXT   NOT NULL,
        email TEXT   NOT NULL UNIQUE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE customers`);
  }
}
