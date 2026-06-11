import { redisClient } from '../redis';

const KEY_PREFIX = 'idempotency:';

class _IdempotencyRepository {
  async get(key: string): Promise<Record<string, unknown> | null> {
    const raw = await redisClient.get(`${KEY_PREFIX}${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async set({
    key,
    value,
    ttlSeconds,
  }: {
    key: string;
    value: Record<string, unknown>;
    ttlSeconds: number;
  }): Promise<void> {
    await redisClient.set(`${KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }
}

export const IdempotencyRepository = new _IdempotencyRepository();
