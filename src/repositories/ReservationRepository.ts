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

  // Set-based: releases every expired active reservation in one statement and returns the
  // reservation_group_id of each released row (one entry per row, not deduped). The caller
  // dedupes to decide which orders to fail. Far cheaper than per-row updates under load.
  async releaseExpiredActive({ manager }: { manager?: EntityManager } = {}): Promise<string[]> {
    const result = await this.getRepo(manager)
      .createQueryBuilder()
      .update()
      .set({ status: 'released' })
      .where('status = :status', { status: 'active' })
      .andWhere('expires_at < NOW()')
      .returning(['reservation_group_id'])
      .execute();

    return (result.raw as { reservation_group_id: string }[]).map((r) => r.reservation_group_id);
  }
}

export const ReservationRepository = new _ReservationRepository();
