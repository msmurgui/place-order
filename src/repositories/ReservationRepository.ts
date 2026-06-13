import { EntityManager } from 'typeorm';
import { InventoryReservation } from '../entities/InventoryReservation';
import { BaseRepository } from './BaseRepository';

interface InsertReservationData {
  inventoryId: number;
  reservationGroupId: string;
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

  async confirmByGroupId({ reservationGroupId, manager }: { reservationGroupId: string; manager?: EntityManager }): Promise<void> {
    await this.getRepo(manager).update({ reservationGroupId, status: 'active' }, { status: 'confirmed' });
  }

  async releaseByGroupId({ reservationGroupId, manager }: { reservationGroupId: string; manager?: EntityManager }): Promise<void> {
    await this.getRepo(manager).update({ reservationGroupId, status: 'active' }, { status: 'released' });
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
