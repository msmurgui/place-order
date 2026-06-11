import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderItems1749513606000 implements MigrationInterface {
  name = 'CreateOrderItems1749513606000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE order_items (
        id                  SERIAL        PRIMARY KEY,
        order_id            INTEGER       NOT NULL REFERENCES orders(id),
        product_id          INTEGER       NOT NULL REFERENCES products(id),
        quantity            INTEGER       NOT NULL,
        unit_price          NUMERIC(10,2) NOT NULL,
        product_name        TEXT          NOT NULL,
        product_sku         TEXT          NOT NULL,
        product_description TEXT          NOT NULL,
        tax_code            TEXT          NOT NULL,
        tax_rate            NUMERIC(5,4)  NOT NULL,
        tax_amount          NUMERIC(10,2) NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE order_items`);
  }
}
