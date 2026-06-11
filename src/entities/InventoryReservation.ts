import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Order } from './Order';

export type ReservationStatus = 'active' | 'confirmed' | 'released';

@Entity('inventory_reservations')
export class InventoryReservation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'inventory_id' })
  inventoryId!: number;

  @Column({ name: 'order_id' })
  orderId!: number;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'text' })
  status!: ReservationStatus;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'NOW()' })
  createdAt!: Date;

  @ManyToOne(() => Order, (order) => order.reservations)
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
