import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../../entities/Order';
import type { OrderItem } from '../../entities/OrderItem';
import type { Warehouse } from '../../entities/Warehouse';

vi.mock('crypto', async (importActual) => {
  const actual = await importActual<typeof import('crypto')>();
  return { ...actual, randomUUID: vi.fn(() => 'group-fixed') };
});
vi.mock('../../util/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../jobs/deadLetterQueue', () => ({ deadLetterQueue: { add: vi.fn() } }));
vi.mock('../WarehouseService/WarehouseService', () => ({ WarehouseService: { findClosestToFulfill: vi.fn() } }));
vi.mock('../ReservationService/ReservationService', () => ({ ReservationService: { createReservations: vi.fn() } }));
vi.mock('./helpers/validateItemsToOrder', () => ({ validateItemsToOrder: vi.fn() }));
vi.mock('./helpers/buildPreTaxLineItems', () => ({ buildPreTaxLineItems: vi.fn() }));
vi.mock('./helpers/buildTaxedLineItems', () => ({ buildTaxedLineItems: vi.fn() }));
vi.mock('./helpers/persistOrder', () => ({ persistOrder: vi.fn() }));
vi.mock('./helpers/chargeOrder', () => ({ chargeOrder: vi.fn() }));
vi.mock('./helpers/confirmOrderAndReservations', () => ({ confirmOrderAndReservations: vi.fn() }));
vi.mock('./helpers/releaseOrderAndReservations', () => ({ releaseOrderAndReservations: vi.fn() }));

import { WarehouseService } from '../WarehouseService/WarehouseService';
import { ReservationService } from '../ReservationService/ReservationService';
import { validateItemsToOrder } from './helpers/validateItemsToOrder';
import { buildPreTaxLineItems } from './helpers/buildPreTaxLineItems';
import { buildTaxedLineItems } from './helpers/buildTaxedLineItems';
import { persistOrder } from './helpers/persistOrder';
import { chargeOrder } from './helpers/chargeOrder';
import { confirmOrderAndReservations } from './helpers/confirmOrderAndReservations';
import { releaseOrderAndReservations } from './helpers/releaseOrderAndReservations';
import { deadLetterQueue } from '../../jobs/deadLetterQueue';
import { OrderService } from './OrderService';

const reservationGroupId = 'group-fixed';
const items = [{ productId: 1, quantity: 2 }];
const orderInput = {
  customerId: 1,
  shippingAddress: '123 Main St, Seattle WA',
  items,
  cardNumber: '4111111111111111',
  idempotencyKey: 'idem-1',
};

const warehouse = { id: 3, name: 'North', address: 'addr' } as Warehouse;
const pendingOrder = { id: 10, status: 'PENDING_PAYMENT' } as Order;
const confirmedOrder = { id: 10, status: 'CONFIRMED' } as Order;
const createdOrderItems = [{ id: 1 }, { id: 2 }] as OrderItem[];

beforeEach(() => {
  vi.mocked(validateItemsToOrder).mockResolvedValue(new Map());
  vi.mocked(WarehouseService.findClosestToFulfill).mockResolvedValue(warehouse);
  vi.mocked(ReservationService.createReservations).mockResolvedValue(undefined);
  vi.mocked(buildPreTaxLineItems).mockReturnValue({ lineItems: [], subtotal: 100 });
  vi.mocked(buildTaxedLineItems).mockResolvedValue({ taxedLineItems: [], total: 110, totalTaxAmount: 10 });
  vi.mocked(persistOrder).mockResolvedValue({ createdOrder: pendingOrder, createdOrderItems });
  vi.mocked(chargeOrder).mockResolvedValue({ reference: 'pay-1', paymentStatus: 'succeeded' });
  vi.mocked(confirmOrderAndReservations).mockResolvedValue({ order: confirmedOrder });
  vi.mocked(releaseOrderAndReservations).mockResolvedValue(undefined);
  vi.mocked(deadLetterQueue.add).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('placeOrder', () => {
  it('runs the happy path: validate → select warehouse → reserve → persist → charge → confirm', async () => {
    const { order } = await OrderService.placeOrder(orderInput);

    expect(validateItemsToOrder).toHaveBeenCalledWith(items);
    expect(WarehouseService.findClosestToFulfill).toHaveBeenCalledWith({
      orderItems: items,
      shippingAddress: orderInput.shippingAddress,
    });
    expect(ReservationService.createReservations).toHaveBeenCalledWith({
      warehouseId: warehouse.id,
      reservationItems: [{ productId: 1, quantity: 2 }],
      reservationGroupId,
    });
    expect(chargeOrder).toHaveBeenCalledWith({
      orderId: pendingOrder.id,
      orderItemIds: [1, 2],
      total: 110,
      cardNumber: orderInput.cardNumber,
    });
    expect(confirmOrderAndReservations).toHaveBeenCalledWith({
      orderId: pendingOrder.id,
      reservationGroupId,
      paymentReference: 'pay-1',
    });
    expect(releaseOrderAndReservations).not.toHaveBeenCalled();
    expect(order).toBe(confirmedOrder);
  });

  it('reserves inventory before persisting or charging the order', async () => {
    await OrderService.placeOrder(orderInput);

    const reserveCall = vi.mocked(ReservationService.createReservations).mock.invocationCallOrder[0];
    const persistCall = vi.mocked(persistOrder).mock.invocationCallOrder[0];
    const chargeCall = vi.mocked(chargeOrder).mock.invocationCallOrder[0];

    expect(reserveCall).toBeLessThan(persistCall);
    expect(persistCall).toBeLessThan(chargeCall);
  });

  it('leaves the order PENDING_PAYMENT and skips confirmation when payment is not yet succeeded', async () => {
    vi.mocked(chargeOrder).mockResolvedValue({ reference: 'pay-1', paymentStatus: 'unknown' });

    const { order } = await OrderService.placeOrder(orderInput);

    expect(confirmOrderAndReservations).not.toHaveBeenCalled();
    expect(releaseOrderAndReservations).not.toHaveBeenCalled();
    expect(order).toBe(pendingOrder);
  });

  it('releases reservations and rethrows when a step fails after the order is created', async () => {
    const paymentError = new Error('payment declined');
    vi.mocked(chargeOrder).mockRejectedValue(paymentError);

    await expect(OrderService.placeOrder(orderInput)).rejects.toThrow(paymentError);

    expect(releaseOrderAndReservations).toHaveBeenCalledWith({
      orderId: pendingOrder.id,
      reservationGroupId,
    });
    expect(confirmOrderAndReservations).not.toHaveBeenCalled();
  });

  it('releases reservations with no orderId when a step fails before the order is created', async () => {
    vi.mocked(buildTaxedLineItems).mockRejectedValue(new Error('tax gateway down'));

    await expect(OrderService.placeOrder(orderInput)).rejects.toThrow('tax gateway down');

    expect(persistOrder).not.toHaveBeenCalled();
    expect(releaseOrderAndReservations).toHaveBeenCalledWith({
      orderId: undefined,
      reservationGroupId,
    });
  });

  it('enqueues a dead-letter job and rethrows the original error when release fails', async () => {
    const paymentError = new Error('payment declined');
    const releaseError = new Error('release failed');
    vi.mocked(chargeOrder).mockRejectedValue(paymentError);
    vi.mocked(releaseOrderAndReservations).mockRejectedValue(releaseError);

    await expect(OrderService.placeOrder(orderInput)).rejects.toThrow(paymentError);

    expect(deadLetterQueue.add).toHaveBeenCalledWith(
      'release-failed',
      expect.objectContaining({
        reservationGroupId,
        orderId: pendingOrder.id,
        failureStage: 'reservation_release',
      })
    );
  });
});
