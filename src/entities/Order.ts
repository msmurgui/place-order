import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Customer } from './Customer';
import { Warehouse } from './Warehouse';
import { OrderItem } from './OrderItem';
import { numericTransformer } from './util/transformers';

export type OrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'FAILED';

export interface ReceiptSnapshotItem {
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  tax_code: string;
  tax_rate: number;
  tax_amount: number;
}

export interface ReceiptSnapshot {
  items: ReceiptSnapshotItem[];
  warehouse: { id: number; name: string; address: string };
  subtotal: number;
  tax_amount: number;
  total: number;
  pricing_at: string;
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'warehouse_id' })
  warehouseId!: number;

  @Column({ type: 'text', name: 'warehouse_name' })
  warehouseName!: string;

  @Column({ type: 'text', name: 'warehouse_address' })
  warehouseAddress!: string;

  @Column({ type: 'jsonb', name: 'shipping_address' })
  shippingAddress!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  subtotal!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'tax_amount', transformer: numericTransformer })
  taxAmount!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  total!: number;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ type: 'text', name: 'payment_reference', nullable: true })
  paymentReference!: string | null;

  @Column({ type: 'text', name: 'idempotency_key', unique: true })
  idempotencyKey!: string;

  @Column({ type: 'uuid', name: 'reservation_group_id', unique: true })
  reservationGroupId!: string;

  @Column({ type: 'jsonb', name: 'receipt_snapshot' })
  receiptSnapshot!: ReceiptSnapshot;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'NOW()' })
  createdAt!: Date;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];
}
