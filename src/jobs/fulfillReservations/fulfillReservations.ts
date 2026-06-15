import { Queue, Worker } from 'bullmq';
import { AppDataSource } from '../../db/dataSource';
import { InventoryRepository } from '../../repositories/InventoryRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { logger } from '../../util/logger';
import { bullConnection } from '../connection';

const QUEUE_NAME = 'fulfill-reservations';
// Runs nightly at 03:00, not on a tight interval. Fulfillment isn't time-sensitive, but it takes
// write locks on inventory rows, so we defer it to a low-traffic window to keep that contention
// off the hot order path. TODO: analyze when the actual low-traffic window is
const FULFILL_CRON = '0 3 * * *';
// Cap per run so a large backlog locks a bounded number of inventory rows rather than the whole
// table at once. The remainder is picked up on the next night's run.
const BATCH_SIZE = 500;

export interface FulfillReservationsResult {
  inventoriesDecremented: number;
  reservationsReleased: number;
}

// Rolls confirmed reservations into physical stock. Each inventory row is decremented and
// its reservations marked released in a short transaction to prevent lock contention.

// TODO: analyze with actual user experience if this should be an event triggered service
// rather than a scheduled job
export const runFulfillReservations = async (): Promise<FulfillReservationsResult> => {
  const groups = await ReservationRepository.findConfirmedGrouped({ limit: BATCH_SIZE });

  let inventoriesDecremented = 0;
  let reservationsReleased = 0;

  for (const group of groups) {
    await AppDataSource.transaction(async (manager) => {
      // Decrement first: if it would violate CHECK (quantity >= 0) the whole transaction rolls
      // back and the reservations stay 'confirmed' for the next run (or manual review).
      await InventoryRepository.decrementQuantity({
        inventoryId: group.inventoryId,
        amount: group.totalQuantity,
        manager,
      });

      // Release exactly the rows we summed; the repository's status guard makes overlapping
      // runs safe — a row already released by a concurrent run is simply skipped.
      await ReservationRepository.releaseConfirmedByIds({
        reservationIds: group.reservationIds,
        manager,
      });
    });

    inventoriesDecremented++;
    reservationsReleased += group.reservationIds.length;
  }

  if (groups.length > 0) {
    // Stands in for the inventory_fulfilled_total metric.
    logger.info(
      { event: 'reservations_fulfilled', inventoriesDecremented, reservationsReleased },
      'confirmed reservations fulfilled'
    );
  }

  return { inventoriesDecremented, reservationsReleased };
};

// Schedules the repeatable job and starts its worker. Queue/Worker are created here (not at
// module load) so importing runFulfillReservations for tests doesn't open a Redis connection.
export const startFulfillReservationsWorker = async (): Promise<Worker> => {
  const queue = new Queue(QUEUE_NAME, { connection: bullConnection });
  await queue.add(
    'fulfill',
    {},
    { repeat: { pattern: FULFILL_CRON }, removeOnComplete: true, removeOnFail: 1000 }
  );
  return new Worker(QUEUE_NAME, async () => runFulfillReservations(), {
    connection: bullConnection,
  });
};
