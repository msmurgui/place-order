import { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { AppDataSource } from '../db/dataSource';

export abstract class BaseRepository<T extends ObjectLiteral> {
  constructor(private readonly target: EntityTarget<T>) {}

  protected get repo(): Repository<T> {
    return AppDataSource.getRepository(this.target);
  }

  protected get dataSource() {
    return AppDataSource;
  }
}
