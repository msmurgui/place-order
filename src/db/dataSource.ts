import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from '../config/env';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  synchronize: false,
  logging: env.NODE_ENV === 'development',
  entities: [`${__dirname}/../entities/*.{ts,js}`],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  migrationsTableName: 'typeorm_migrations',
});
