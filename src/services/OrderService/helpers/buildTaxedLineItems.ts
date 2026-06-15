import { TaxGateway } from '../../../gateways/TaxGateway';
import { assertCircuitClosed } from '../../../middleware/circuitBreaker';
import { round2 } from '../../../util/numbers';
import { PreTaxLineItem } from './buildPreTaxLineItems';

export interface TaxedLineItem extends PreTaxLineItem {
  taxRate: number;
  taxAmount: number;
}

/**
 * Builds taxed line items by calling the TaxGateway to calculate taxes based on 
 * the shipping address and pre-tax line items.
 * 
 * @param params
 * @param params.shippingAddress The shipping address for the order, used for tax calculation.
 * @param params.lineItems The pre-tax line items, including tax codes and subtotals.
 * @param params.subtotal The order subtotal, used to calculate the total with taxes.
 * @returns An object containing the array of taxed line items, the total amount including taxes, and the total tax amount.
 */
export const buildTaxedLineItems = async ({
  shippingAddress,
  lineItems,
  subtotal,
}: {
  shippingAddress: string;
  lineItems: PreTaxLineItem[];
  subtotal: number;
}): Promise<{ taxedLineItems: TaxedLineItem[]; total: number; totalTaxAmount: number }> => {
  await assertCircuitClosed('tax');

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
