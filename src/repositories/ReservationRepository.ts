import { InventoryReservation } from '../entities/InventoryReservation';
import { BaseRepository } from './BaseRepository';

interface InsertReservationData {
  inventoryId: number;
  orderId: number;
  quantity: number;
  expiresAt: Date;
}

class _ReservationRepository extends BaseRepository<InventoryReservation> {
  constructor() {
    super(InventoryReservation);
  }

  async insert(data: InsertReservationData): Promise<InventoryReservation> {
    return this.repo.save(this.repo.create({ ...data, status: 'active' }));
  }

  async confirmByOrderId(orderId: number): Promise<void> {
    await this.repo.update({ orderId, status: 'active' }, { status: 'confirmed' });
  }

  async releaseByOrderId(orderId: number): Promise<void> {
    await this.repo.update({ orderId, status: 'active' }, { status: 'released' });
  }

  async findExpired(): Promise<InventoryReservation[]> {
    return this.repo
      .createQueryBuilder('r')
      .where("r.status = 'active'")
      .andWhere('r.expiresAt < NOW()')
      .getMany();
  }
}

export const ReservationRepository = new _ReservationRepository();
