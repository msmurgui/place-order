import { Queue, Worker } from 'bullmq';
import { PaymentGateway } from '../../gateways/PaymentGateway';
import { OrderRepository } from '../../repositories/OrderRepository';
import { OrderService } from '../../services/OrderService/OrderService';
import { logger } from '../../util/logger';
import { bullConnection } from '../connection';

const QUEUE_NAME = 'reconcile-orders';
const INTERVAL_MS = 5 * 60_000; // every 5 minutes
// Cap per run so a large backlog (e.g. after a gateway outage) is drained over several
// runs rather than loaded all at once. Remaining orders are picked up on the next run.
const BATCH_SIZE = 100;

export interface ReconcileOrdersResult {
  confirmed: number;
  failed: number;
  skipped: number;
}

// Resolves orders left PENDING_PAYMENT (payment was attempted but not settled inline) by
// polling the gateway for each one's payment reference, then confirming or releasing.
export const runReconcileOrders = async (): Promise<ReconcileOrdersResult> => {
  // Cap the number of orders we try to reconcile in one go, to avoid overloading the gateway
  // If there are more than BATCH_SIZE stale orders, the rest will be picked up on the next run.
  const staleOrders = await OrderRepository.findStalePending({ limit: BATCH_SIZE });

  let confirmed = 0;
  let failed = 0;
  let skipped = 0;

  for (const order of staleOrders) {
    const { paymentReference, reservationGroupId } = order;

    // No reference recorded → nothing to poll. Leave it for the expiry job / manual review.
    if (!paymentReference) {
      logger.warn({ orderId: order.id }, 'stale pending order has no payment reference — skipping');
      skipped++;
      continue;
    }

    try {
      const status = await PaymentGateway.getStatus(paymentReference);

      if (status === 'succeeded') {
        await OrderService.applyPaymentResult({
          orderId: order.id,
          reservationGroupId,
          paymentReference,
          paymentStatus: 'succeeded',
        });
        confirmed++;
      } else if (status === 'failed') {
        await OrderService.releaseOrderAndReservations({ orderId: order.id, reservationGroupId });
        failed++;
      } else {
        // 'unknown' — still pending at the gateway; retry on the next run.
        skipped++;
      }
    } catch (error: unknown) {
      // One bad order shouldn't abort the whole batch.
      logger.error({ error, orderId: order.id }, 'failed to reconcile order');
      skipped++;
    }
  }

  if (staleOrders.length > 0) {
    logger.info(
      { event: 'orders_reconciled', confirmed, failed, skipped },
      'reconciled stale pending orders'
    );
  }

  return { confirmed, failed, skipped };
};

// Schedules the repeatable job and starts its worker. Queue/Worker are created here (not at
// module load) so importing runReconcileOrders for tests doesn't open a Redis connection.
export const startReconcileOrdersWorker = async (): Promise<Worker> => {
  const queue = new Queue(QUEUE_NAME, { connection: bullConnection });
  await queue.add(
    'reconcile',
    {},
    { repeat: { every: INTERVAL_MS }, removeOnComplete: true, removeOnFail: 1000 }
  );
  return new Worker(QUEUE_NAME, async () => runReconcileOrders(), { connection: bullConnection });
};
