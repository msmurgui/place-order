import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1749513605000 implements MigrationInterface {
  name = 'CreateOrders1749513605000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE orders (
        id                SERIAL        PRIMARY KEY,
        customer_id       INTEGER       NOT NULL REFERENCES customers(id),
        warehouse_id      INTEGER       NOT NULL REFERENCES warehouses(id),
        warehouse_name    TEXT          NOT NULL,
        warehouse_address TEXT          NOT NULL,
        shipping_address  JSONB         NOT NULL,
        subtotal          NUMERIC(10,2) NOT NULL,
        tax_amount        NUMERIC(10,2) NOT NULL,
        total             NUMERIC(10,2) NOT NULL,
        status            TEXT          NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'FAILED')),
        payment_reference TEXT,
        idempotency_key   TEXT          NOT NULL UNIQUE,
        receipt_snapshot  JSONB         NOT NULL,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT orders_total_check CHECK (total = subtotal + tax_amount)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE orders`);
  }
}
