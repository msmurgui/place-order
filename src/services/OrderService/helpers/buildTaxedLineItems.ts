import { TaxGateway } from '../../../gateways/TaxGateway';
import { redisClient } from '../../../redis';
import { CircuitOpenError } from '../../../util/errors';
import { round2 } from '../../../util/numbers';
import { PreTaxLineItem } from './buildPreTaxLineItems';

export interface TaxedLineItem extends PreTaxLineItem {
  taxRate: number;
  taxAmount: number;
}

export const buildTaxedLineItems = async ({
  shippingAddress,
  lineItems,
  subtotal,
}: {
  shippingAddress: string;
  lineItems: PreTaxLineItem[];
  subtotal: number;
}): Promise<{ taxedLineItems: TaxedLineItem[]; total: number; totalTaxAmount: number }> => {
  const taxCircuitOpen = await redisClient.get('circuit:tax');
  if (taxCircuitOpen === '1') throw new CircuitOpenError('tax');

  const taxResult = await TaxGateway.calculate({
    shippingAddress,
    items: lineItems.map((i) => ({ taxCode: i.taxCode, amount: i.lineSubtotal })),
  });

  // breakdown is index-aligned with lineItems — one entry per item, not per tax code.
  const taxedLineItems: TaxedLineItem[] = lineItems.map((item, idx) => ({
    ...item,
    taxRate: taxResult.breakdown[idx].taxRate,
    taxAmount: taxResult.breakdown[idx].taxAmount,
  }));

  const total = round2(subtotal + taxResult.totalTaxAmount);

  return { taxedLineItems, total, totalTaxAmount: taxResult.totalTaxAmount };
};
