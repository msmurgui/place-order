import { Warehouse } from '../entities/Warehouse';
import { BaseRepository } from './BaseRepository';

class _WarehouseRepository extends BaseRepository<Warehouse> {
  constructor() {
    super(Warehouse);
  }

  async findAll(): Promise<Warehouse[]> {
    return this.repo.find();
  }
}

export const WarehouseRepository = new _WarehouseRepository();
