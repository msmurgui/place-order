import { In } from 'typeorm';
import { Product } from '../entities/Product';
import { BaseRepository } from './BaseRepository';

class _ProductRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  async findByIds(ids: number[]): Promise<Product[]> {
    return this.repo.findBy({ id: In(ids) });
  }
}

export const ProductRepository = new _ProductRepository();
