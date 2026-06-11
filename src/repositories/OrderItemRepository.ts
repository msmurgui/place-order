import { OrderItem } from '../entities/OrderItem';
import { BaseRepository } from './BaseRepository';

export interface InsertOrderItemData {
  orderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  productName: string;
  productSku: string;
  productDescription: string;
  taxCode: string;
  taxRate: number;
  taxAmount: number;
}

class _OrderItemRepository extends BaseRepository<OrderItem> {
  constructor() {
    super(OrderItem);
  }

  async insertMany(items: InsertOrderItemData[]): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(OrderItem)
      .values(items)
      .execute();
  }
}

export const OrderItemRepository = new _OrderItemRepository();
