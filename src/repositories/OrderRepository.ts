import { EntityManager } from 'typeorm';
import { Order, OrderStatus, ReceiptSnapshot } from '../entities/Order';
import { BaseRepository } from './BaseRepository';

export interface InsertOrderData {
  customerId: number;
  warehouseId: number;
  warehouseName: string;
  warehouseAddress: string;
  shippingAddress: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  status: OrderStatus;
  idempotencyKey: string;
  reservationGroupId: string;
  receiptSnapshot: ReceiptSnapshot;
}

class _OrderRepository extends BaseRepository<Order> {
  constructor() {
    super(Order);
  }

  async insert({ data, manager }: { data: InsertOrderData; manager?: EntityManager }): Promise<Order> {
    const repo = this.getRepo(manager);
    return repo.save(repo.create(data));
  }

  async updateStatus({
    orderId,
    status,
    paymentReference,
    manager,
  }: {
    orderId: number;
    status: OrderStatus;
    paymentReference?: string;
    manager?: EntityManager;
  }): Promise<Order> {
    const repo = this.getRepo(manager);
    const update: Partial<Order> = { status };
    if (paymentReference !== undefined) {
      update.paymentReference = paymentReference;
    }
    await repo.update(orderId, update);
    return repo.findOneByOrFail({ id: orderId });
  }

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    return this.repo.findOneBy({ idempotencyKey: key });
  }

  // Set-based: marks every still-pending order in the given reservation groups FAILED.
  // Used by the expiry job after releasing reservations. Returns the number of orders failed.
  async failPendingByGroupIds({
    groupIds,
    manager,
  }: {
    groupIds: string[];
    manager?: EntityManager;
  }): Promise<number> {
    if (groupIds.length === 0) return 0;

    const result = await this.getRepo(manager)
      .createQueryBuilder()
      .update()
      .set({ status: 'FAILED' })
      .where('status = :status', { status: 'PENDING_PAYMENT' })
      .andWhere('reservation_group_id IN (:...groupIds)', { groupIds })
      .execute();

    return result.affected ?? 0;
  }

  async findStalePending({ limit }: { limit?: number } = {}): Promise<Order[]> {
    const qb = this.repo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: 'PENDING_PAYMENT' })
      .andWhere("order.createdAt < NOW() - INTERVAL '5 minutes'");

    if (limit !== undefined) {
      qb.take(limit);
    }

    return qb.getMany();
  }
}

export const OrderRepository = new _OrderRepository();
