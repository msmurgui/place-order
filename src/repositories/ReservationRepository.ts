import { EntityManager } from 'typeorm';
import { InventoryReservation } from '../entities/InventoryReservation';
import { BaseRepository } from './BaseRepository';

interface InsertReservationData {
  inventoryId: number;
  reservationGroupId: string;
  quantity: number;
  expiresAt: Date;
}

export interface ConfirmedReservationGroup {
  inventoryId: number;
  totalQuantity: number;
  reservationIds: number[];
}

class _ReservationRepository extends BaseRepository<InventoryReservation> {
  constructor() {
    super(InventoryReservation);
  }

  // Accepts an optional manager so the insert can run inside the caller's transaction —
  // it shares the advisory-lock window opened in ReservationService.createReservations.
  async insert(
    data: InsertReservationData,
    manager?: EntityManager
  ): Promise<InventoryReservation> {
    const repo = this.getRepo(manager);
    return repo.save(repo.create({ ...data, status: 'active' }));
  }

  // Rolls up confirmed reservations per inventory row.
  async findConfirmedGrouped({
    limit,
    manager,
  }: {
    limit: number;
    manager?: EntityManager;
  }): Promise<ConfirmedReservationGroup[]> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query<
      { inventory_id: string; total_quantity: string; reservation_ids: string[] }[]
    >(
      `SELECT inventory_id,
              SUM(quantity) AS total_quantity,
              ARRAY_AGG(id) AS reservation_ids
       FROM inventory_reservations
       WHERE status = 'confirmed'
       GROUP BY inventory_id
       ORDER BY inventory_id
       LIMIT $1`,
      [limit]
    );

    return rows.map((r) => ({
      inventoryId: parseInt(r.inventory_id, 10),
      totalQuantity: parseInt(r.total_quantity, 10),
      reservationIds: r.reservation_ids.map((id) => parseInt(id, 10)),
    }));
  }

  // Marks the given confirmed reservations as 'released'. The status = 'confirmed' guard makes
  // overlapping fulfillment runs safe — a row already released by a concurrent run is skipped.
  async releaseConfirmedByIds({
    reservationIds,
    manager,
  }: {
    reservationIds: number[];
    manager?: EntityManager;
  }): Promise<void> {
    if (reservationIds.length === 0) return;
    await this.getRepo(manager)
      .createQueryBuilder()
      .update()
      .set({ status: 'released' })
      .where('id IN (:...reservationIds)', { reservationIds })
      .andWhere('status = :status', { status: 'confirmed' })
      .execute();
  }

  async confirmByGroupId({
    reservationGroupId,
    manager,
  }: {
    reservationGroupId: string;
    manager?: EntityManager;
  }): Promise<void> {
    await this.getRepo(manager).update(
      { reservationGroupId, status: 'active' },
      { status: 'confirmed' }
    );
  }

  async releaseByGroupId({
    reservationGroupId,
    manager,
  }: {
    reservationGroupId: string;
    manager?: EntityManager;
  }): Promise<void> {
    await this.getRepo(manager).update(
      { reservationGroupId, status: 'active' },
      { status: 'released' }
    );
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
