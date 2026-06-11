import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { numericTransformer } from './util/transformers';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', unique: true })
  sku!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  price!: number;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', name: 'tax_code' })
  taxCode!: string;
}
