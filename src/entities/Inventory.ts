import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Warehouse } from './Warehouse';
import { Product } from './Product';

@Entity('inventories')
export class Inventory {
  @PrimaryColumn({ name: 'warehouse_id' })
  warehouseId!: number;

  @PrimaryColumn({ name: 'product_id' })
  productId!: number;

  @Column({ type: 'int' })
  quantity!: number;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
