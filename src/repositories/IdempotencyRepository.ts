import { Redis } from 'ioredis';

const KEY_PREFIX = 'idempotency:';

export class IdempotencyRepository {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async set(key: string, value: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
