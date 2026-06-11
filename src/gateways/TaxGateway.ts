export class TaxCalculationError extends Error {
  constructor(taxCode: string) {
    super(`Unknown tax code: ${taxCode}`);
    this.name = 'TaxCalculationError';
  }
}

export interface TaxLineItem {
  taxCode: string;
  amount: number; // line-item subtotal
}

export interface TaxBreakdownItem {
  taxCode: string;
  taxRate: number;
  taxAmount: number;
}

export interface TaxResult {
  totalTaxAmount: number;
  breakdown: TaxBreakdownItem[];
}

const TAX_RATES: Record<string, number> = {
  GROCERY: 0.0,
  ELECTRONICS: 0.21,
  STANDARD: 0.1,
  EXEMPT: 0.0,
};

class _TaxGateway {
  async calculate({
    items,
  }: {
    shippingAddress: string;
    items: TaxLineItem[];
  }): Promise<TaxResult> {
    const breakdown: TaxBreakdownItem[] = items.map((item) => {
      const taxRate = TAX_RATES[item.taxCode];
      if (taxRate === undefined) throw new TaxCalculationError(item.taxCode);

      return {
        taxCode: item.taxCode,
        taxRate,
        taxAmount: Math.round(item.amount * taxRate * 100) / 100,
      };
    });

    const totalTaxAmount =
      Math.round(breakdown.reduce((sum, b) => sum + b.taxAmount, 0) * 100) /
      100;

    return { totalTaxAmount, breakdown };
  }
}

export const TaxGateway = new _TaxGateway();
