import { env } from '../config/env';

// BullMQ bundles its own ioredis, so it can't share the app's redisClient instance
// (type-incompatible builds). Pass plain connection options parsed from the URL instead.
const redisUrl = new URL(env.REDIS_URL);

export const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
};
