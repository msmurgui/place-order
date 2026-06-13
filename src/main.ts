import 'reflect-metadata';
import type { Server } from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { AppDataSource } from './db/dataSource';
import { redisClient } from './redis';
import { logger } from './util/logger';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('database initialized');

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'server listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await AppDataSource.destroy();
    await redisClient.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error({ error }, 'failed to start server');
  process.exit(1);
});
