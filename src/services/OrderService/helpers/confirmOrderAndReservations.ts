import { AppDataSource } from '../../../db/dataSource';
import { Order } from '../../../entities/Order';
import { OrderRepository } from '../../../repositories/OrderRepository';
import { ReservationService } from '../../ReservationService/ReservationService';

export const confirmOrderAndReservations = async ({
  orderId,
  reservationGroupId,
  paymentReference,
}: {
  orderId: number;
  reservationGroupId: string;
  paymentReference: string;
}): Promise<{ order: Order }> => {
  // Confirm reservations and finalize status atomically — prevents confirmed
  // reservations from being visible while the order still shows PENDING_PAYMENT.
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
};
