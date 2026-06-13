import { Product } from '../../../entities/Product';
import { ProductRepository } from '../../../repositories/ProductRepository';

export const validateItemsToOrder = async (
  items: { productId: number; quantity: number }[]
): Promise<Map<number, Product>> => {
  const products = await ProductRepository.findByIds(items.map((i) => i.productId));
  if (products.length !== items.length) {
    throw new Error('One or more products not found');
  }

  // Any extra validation rules around product validation
  // would be added here, such as checking if the product
  // is active, or any other business rules around product
  // eligibility for ordering.

  const productByIdMap = new Map(products.map((p) => [p.id, p]));
  return productByIdMap;
};
