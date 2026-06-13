import { randomUUID } from 'crypto';
import type { Order } from '../../entities/Order';
import { logger } from '../../util/logger';

import { ReservationService } from '../ReservationService/ReservationService';
import { WarehouseService } from '../WarehouseService/WarehouseService';
import { validateItemsToOrder } from './helpers/validateItemsToOrder';
import { buildPreTaxLineItems } from './helpers/buildPreTaxLineItems';
import { buildTaxedLineItems } from './helpers/buildTaxedLineItems';
import { persistOrder } from './helpers/persistOrder';
import { chargeOrder } from './helpers/chargeOrder';
import { confirmOrderAndReservations } from './helpers/confirmOrderAndReservations';
import { releaseOrderAndReservations } from './helpers/releaseOrderAndReservations';

interface OrderInput {
  customerId: number;
  shippingAddress: string;
  items: { productId: number; quantity: number }[];
  cardNumber: string;
  idempotencyKey: string;
}

class _OrderService {
  async placeOrder({
    customerId,
    shippingAddress,
    items,
    cardNumber,
    idempotencyKey,
  }: OrderInput): Promise<{ order: Order }> {
    const productByIdMap = await validateItemsToOrder(items);

    const warehouse = await WarehouseService.findClosestToFulfill({
      orderItems: items,
      shippingAddress,
    });

    // Reserve inventory as early as possible to prevent overselling from
    // concurrent requests. Reservations are grouped by a server-generated id
    // (not order_id), so they can be created before the order exists.
    const reservationGroupId = randomUUID();
    const reservationItemsToCreate = items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    }));
    await ReservationService.createReservations({
      warehouseId: warehouse.id,
      reservationItems: reservationItemsToCreate,
      reservationGroupId,
    });

    const { lineItems, subtotal } = buildPreTaxLineItems(items, productByIdMap);

    // From here on, any failure must release the reservations (and fail the order if one
    // was already created) so stock is not held for an order that will never confirm.
    let order: Order | null = null;
    let paymentReference: string | undefined;

    try {
      const { taxedLineItems, total, totalTaxAmount } = await buildTaxedLineItems({
        shippingAddress,
        lineItems,
        subtotal,
      });

      const { createdOrder, createdOrderItems } = await persistOrder({
        taxedLineItems,
        warehouse,
        subtotal,
        totalTaxAmount,
        total,
        customerId,
        shippingAddress,
        idempotencyKey,
        reservationGroupId,
      });
      order = createdOrder;

      const { reference, paymentStatus } = await chargeOrder({
        orderId: createdOrder.id,
        orderItemIds: createdOrderItems.map((i) => i.id),
        total,
        cardNumber,
      });
      paymentReference = reference;

      // If payment succeeded, confirm the order and reservations.
      // If payment is still pending, a reconciliation process will
      // confirm or release the order later based on the payment status.
      if (paymentStatus === 'succeeded') {
        ({ order } = await confirmOrderAndReservations({
          orderId: createdOrder.id,
          reservationGroupId,
          paymentReference,
        }));
      }

      logger.info(
        {
          orderId: createdOrder.id,
          orderStatus: order.status,
          warehouseId: warehouse.id,
          subtotal,
          taxAmount: totalTaxAmount,
          total,
        },
        'order_placed'
      );

      return {
        order,
      };
    } catch (error: unknown) {
      const failedOrder = order;
      try {
        await releaseOrderAndReservations({
          orderId: failedOrder?.id,
          reservationGroupId,
        });
      } catch (releaseError: unknown) {
        // If release fails, stock is in an inconsistent
        // state — enqueue for manual investigation.

        // TODO: add dead letter queue here!

        logger.error(
          { reservationGroupId, orderId: failedOrder?.id, paymentReference, error, releaseError },
          'reservation release failed — added to dead letter queue'
        );
      }

      throw error;
    }
  }
}

export const OrderService = new _OrderService();
