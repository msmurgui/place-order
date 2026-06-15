import { AppDataSource } from '../../../db/dataSource';
import { Order, ReceiptSnapshot } from '../../../entities/Order';
import { OrderItem } from '../../../entities/OrderItem';
import { Warehouse } from '../../../entities/Warehouse';
import { OrderItemRepository } from '../../../repositories/OrderItemRepository';
import { OrderRepository } from '../../../repositories/OrderRepository';
import { TaxedLineItem } from './buildTaxedLineItems';

/**
 * Persists a pending order with its items and receipt snapshot
 * 
 * @param params
 * @param params.taxedLineItems The line items with tax details to be included in the order and receipt snapshot.
 * @param params.warehouse The warehouse fulfilling the order
 * @param params.subtotal The order subtotal of the order (pre-tax)
 * @param params.totalTaxAmount The total tax amount for the order (pre-tax)
 * @param params.total The total amount for the order (including tax)
 * @param params.customerId The ID of the customer placing the order
 * @param params.shippingAddress The shipping address for the order
 * @param params.idempotencyKey The idempotency key for the order, used to prevent duplicate orders from retries.
 * @param params.reservationGroupId The reservation group ID associated with the inventory reservations for this order
 * 
 * @returns An object containing the created order and its items.
 */
export const persistOrder = async ({
  taxedLineItems,
  warehouse,
  subtotal,
  totalTaxAmount,
  total,
  customerId,
  shippingAddress,
  idempotencyKey,
  reservationGroupId,
}: {
  taxedLineItems: TaxedLineItem[];
  warehouse: Warehouse;
  subtotal: number;
  totalTaxAmount: number;
  total: number;
  customerId: number;
  shippingAddress: string;
  idempotencyKey: string;
  reservationGroupId: string;
}): Promise<{ createdOrder: Order; createdOrderItems: OrderItem[] }> => {
  // Snapshot is written once and never updated — it is the immutable record of what the customer was charged.
  const receiptSnapshot: ReceiptSnapshot = {
    items: taxedLineItems.map((i) => ({
      product_id: i.productId,
      product_name: i.productName,
      sku: i.productSku,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      subtotal: i.lineSubtotal,
      tax_code: i.taxCode,
      tax_rate: i.taxRate,
      tax_amount: i.taxAmount,
    })),
    warehouse: { id: warehouse.id, name: warehouse.name, address: warehouse.address },
    subtotal,
    tax_amount: totalTaxAmount,
    total,
    pricing_at: new Date().toISOString(),
  };

  // Order and its items are inserted atomically — a failed item insert rolls back the order.
  return AppDataSource.transaction(async (manager) => {
    const createdOrder = await OrderRepository.insert({
      data: {
        customerId,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        warehouseAddress: warehouse.address,
        shippingAddress,
        subtotal,
        taxAmount: totalTaxAmount,
        total,
        status: 'PENDING_PAYMENT',
        idempotencyKey,
        reservationGroupId,
        receiptSnapshot,
      },
      manager,
    });

    const createdOrderItems = await OrderItemRepository.insertMany({
      items: taxedLineItems.map((item) => ({
        orderId: createdOrder.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productName: item.productName,
        productSku: item.productSku,
        productDescription: item.productDescription,
        taxCode: item.taxCode,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
      })),
      manager,
    });

    return { createdOrder, createdOrderItems };
  });
};
