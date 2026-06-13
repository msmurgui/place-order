import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type ReservationStatus = 'active' | 'confirmed' | 'released';

@Entity('inventory_reservations')
export class InventoryReservation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'inventory_id' })
  inventoryId!: number;

  @Column({ type: 'uuid', name: 'reservation_group_id' })
  reservationGroupId!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'text' })
  status!: ReservationStatus;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'NOW()' })
  createdAt!: Date;
}
