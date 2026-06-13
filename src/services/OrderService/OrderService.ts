import { randomUUID } from 'crypto';
import type { Order } from '../../entities/Order';
import { PaymentDeclinedError, type PaymentStatus } from '../../gateways/PaymentGateway';
import { AppDataSource } from '../../db/dataSource';
import { OrderRepository } from '../../repositories/OrderRepository';
import { logger } from '../../util/logger';
import { ReservationService } from '../ReservationService/ReservationService';
import { WarehouseService } from '../WarehouseService/WarehouseService';
import { validateItemsToOrder } from './helpers/validateItemsToOrder';
import { buildPreTaxLineItems } from './helpers/buildPreTaxLineItems';
import { buildTaxedLineItems } from './helpers/buildTaxedLineItems';
import { persistOrder } from './helpers/persistOrder';
import { chargeOrder } from './helpers/chargeOrder';
import { deadLetterQueue } from '../../jobs/deadLetterQueue';

export interface OrderToPlace {
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
  }: OrderToPlace): Promise<{ order: Order }> {
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

      // At this point the charge is either successful or still pending; failed payments
      // were thrown by chargeOrder so the compensation path below handles them.
      ({ order } = await this.applyPaymentResult({
        orderId: createdOrder.id,
        reservationGroupId,
        paymentReference,
        paymentStatus,
      }));

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

      return { order };
    } catch (error: unknown) {
      const failedOrder = order;
      try {
        await this.releaseOrderAndReservations({ orderId: failedOrder?.id, reservationGroupId });
      } catch (releaseError: unknown) {
        // If release fails, stock is in an inconsistent state — enqueue for manual investigation.
        await deadLetterQueue.add('release-failed', {
          reservationGroupId,
          orderId: failedOrder?.id ?? null,
          failureStage: 'reservation_release',
          paymentReference,
          error: JSON.stringify(error),
          releaseError: JSON.stringify(releaseError),
        });

        logger.error(
          { reservationGroupId, orderId: failedOrder?.id, paymentReference, error, releaseError },
          'reservation release failed — added to dead letter queue'
        );
      }

      throw error;
    }
  }

  // Applies a payment result to an order. Shared by placeOrder and the reconcileOrders job:
  //   - succeeded → confirm reservations and mark the order CONFIRMED (atomically, so confirmed
  //     reservations are never visible while the order still shows PENDING_PAYMENT)
  //   - failed → surface as a declined charge so the caller runs the compensation path
  //   - otherwise → not settled yet; persist the reference and leave it PENDING_PAYMENT for
  //     reconcileOrders to resolve later
  async applyPaymentResult({
    orderId,
    reservationGroupId,
    paymentReference,
    paymentStatus,
  }: {
    orderId: number;
    reservationGroupId: string;
    paymentReference: string;
    paymentStatus: PaymentStatus;
  }): Promise<{ order: Order }> {
    if (paymentStatus === 'failed') {
      throw new PaymentDeclinedError('payment failed after charge');
    }

    if (paymentStatus === 'succeeded') {
      return AppDataSource.transaction(async (manager) => {
        await ReservationService.confirmReservations({ reservationGroupId, manager });
        const order = await OrderRepository.updateStatus({
          orderId,
          status: 'CONFIRMED',
          paymentReference,
          manager,
        });
        return { order };
      });
    }

    const order = await OrderRepository.updateStatus({ orderId, status: 'PENDING_PAYMENT', paymentReference });
    return { order };
  }

  // Releases an order's reservations and marks it FAILED (if the order was created), atomically.
  // Shared by placeOrder's compensation path and the reconcileOrders job.
  async releaseOrderAndReservations({
    orderId,
    reservationGroupId,
  }: {
    orderId?: number;
    reservationGroupId: string;
  }): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      await ReservationService.releaseReservations({ reservationGroupId, manager });
      if (orderId) {
        await OrderRepository.updateStatus({ orderId, status: 'FAILED', manager });
      }
    });
  }
}

export const OrderService = new _OrderService();
