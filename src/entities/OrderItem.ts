import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Order } from './Order';
import { Product } from './Product';
import { numericTransformer } from './util/transformers';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'order_id' })
  orderId!: number;

  @Column({ name: 'product_id' })
  productId!: number;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'unit_price', transformer: numericTransformer })
  unitPrice!: number;

  @Column({ type: 'text', name: 'product_name' })
  productName!: string;

  @Column({ type: 'text', name: 'product_sku' })
  productSku!: string;

  @Column({ type: 'text', name: 'product_description' })
  productDescription!: string;

  @Column({ type: 'text', name: 'tax_code' })
  taxCode!: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, name: 'tax_rate', transformer: numericTransformer })
  taxRate!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'tax_amount', transformer: numericTransformer })
  taxAmount!: number;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
