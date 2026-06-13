import { AppDataSource } from '../../../db/dataSource';
import { OrderRepository } from '../../../repositories/OrderRepository';
import { ReservationService } from '../../ReservationService/ReservationService';

export const releaseOrderAndReservations = async ({
  orderId,
  reservationGroupId,
}: {
  orderId?: number;
  reservationGroupId: string;
}) => {
  // Release reservations (and mark the order failed, if it was created) atomically.
  await AppDataSource.transaction(async (manager) => {
    await ReservationService.releaseReservations({ reservationGroupId, manager });
    if (orderId) {
      await OrderRepository.updateStatus({
        orderId,
        status: 'FAILED',
        manager,
      });
    }
  });
};
