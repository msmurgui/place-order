import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from '../config/env';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DB_URL,
  synchronize: false,
  logging: env.NODE_ENV === 'development',
  entities: [`${__dirname}/../entities/*.{ts,js}`],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  migrationsTableName: 'typeorm_migrations',
});
