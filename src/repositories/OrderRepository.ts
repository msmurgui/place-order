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

  async findStalePending(): Promise<Order[]> {
    return this.repo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: 'PENDING_PAYMENT' })
      .andWhere("order.createdAt < NOW() - INTERVAL '5 minutes'")
      .getMany();
  }
}

export const OrderRepository = new _OrderRepository();
