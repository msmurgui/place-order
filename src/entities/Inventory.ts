import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Warehouse } from './Warehouse';
import { Product } from './Product';

@Unique(['warehouseId', 'productId'])
@Entity('inventories')
export class Inventory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'warehouse_id' })
  warehouseId!: number;

  @Column({ name: 'product_id' })
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
