import { Queue, Worker } from 'bullmq';
import { AppDataSource } from '../../db/dataSource';
import { OrderRepository } from '../../repositories/OrderRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { logger } from '../../util/logger';
import { bullConnection } from '../connection';

const QUEUE_NAME = 'expire-reservations';
const INTERVAL_MS = 60_000; // every 1 minute

export interface ExpireReservationsResult {
  releasedReservations: number;
  failedOrders: number;
}

// Releases all expired active reservations and fails any order still PENDING_PAYMENT whose
// reservations just expired. Both steps run set-based in a single transaction.
export const runExpireReservations = async (): Promise<ExpireReservationsResult> => {
  return AppDataSource.transaction(async (manager) => {
    const releasedGroupIds = await ReservationRepository.releaseExpiredActive({ manager });
    const distinctGroupIds = [...new Set(releasedGroupIds)];
    const failedOrders = await OrderRepository.failPendingByGroupIds({ groupIds: distinctGroupIds, manager });

    if (releasedGroupIds.length > 0) {
      // Stands in for the inventory_reservations_expired_total / orders_failed_total metrics.
      logger.info(
        { event: 'reservations_expired', releasedReservations: releasedGroupIds.length, failedOrders },
        'expired reservations released'
      );
    }

    return { releasedReservations: releasedGroupIds.length, failedOrders };
  });
};

// Schedules the repeatable job and starts the worker that processes it. Returns the worker
// so the caller can close it on shutdown. The Queue/Worker are created here (not at module
// load) so importing runExpireReservations for tests doesn't open a Redis connection.
export const startExpireReservationsWorker = async (): Promise<Worker> => {
  const queue = new Queue(QUEUE_NAME, { connection: bullConnection });

  // Idempotent: re-adding the same repeatable spec doesn't create duplicates.
  await queue.add('expire', {}, { repeat: { every: INTERVAL_MS }, removeOnComplete: true, removeOnFail: 1000 });

  return new Worker(QUEUE_NAME, async () => runExpireReservations(), { connection: bullConnection });
};
