import { Product } from '../../../entities/Product';
import { round2 } from '../../../util/numbers';

export interface PreTaxLineItem {
  productId: number;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  productName: string;
  productSku: string;
  productDescription: string;
  taxCode: string;
}

/**
 * Builds pre-tax line items and calculates the order subtotal.
 * 
 * @param items The items to order, with productId and quantity.
 * @param productByIdMap A map of productId to Product, used to get product details and price.
 * @returns An object containing the array of pre-tax line items and the order subtotal.
 */
export const buildPreTaxLineItems = (
  items: { productId: number; quantity: number }[],
  productByIdMap: Map<number, Product>
): { lineItems: PreTaxLineItem[]; subtotal: number } => {
  const lineItems: PreTaxLineItem[] = items.map((item) => {
    const product = productByIdMap.get(item.productId)!;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product.price,
      lineSubtotal: round2(product.price * item.quantity),
      productName: product.name,
      productSku: product.sku,
      productDescription: product.description,
      taxCode: product.taxCode,
    };
  });
  const subtotal = round2(lineItems.reduce((sum, i) => sum + i.lineSubtotal, 0));
  return { lineItems, subtotal };
};
