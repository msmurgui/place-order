import { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { AppDataSource } from '../db/dataSource';

export abstract class BaseRepository<T extends ObjectLiteral> {
  constructor(private readonly target: EntityTarget<T>) {}

  protected get repo(): Repository<T> {
    return AppDataSource.getRepository(this.target);
  }

  protected get dataSource() {
    return AppDataSource;
  }

  protected getRepo(manager?: EntityManager): Repository<T> {
    return manager ? manager.getRepository(this.target) : this.repo;
  }
}
