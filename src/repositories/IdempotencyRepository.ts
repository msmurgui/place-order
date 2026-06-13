import { redisClient } from '../redis';

const KEY_PREFIX = 'idempotency:';

// Sentinel written by claim() to reserve a key while the request is in flight, before the
// real response exists. It is intentionally not valid JSON so get() can tell it apart.
const PENDING_SENTINEL = 'pending';

class _IdempotencyRepository {
  async get(key: string): Promise<Record<string, unknown> | null> {
    const raw = await redisClient.get(`${KEY_PREFIX}${key}`);
    if (raw === null) return null;
    // A concurrent request may read the "pending" sentinel before the owner writes the real
    // response. JSON.parse would throw on it — treat it as "no cached response yet" instead.
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Atomically reserves the key for this request. Returns true only for the single caller that
  // wins the SET NX; all concurrent duplicates get false and must fall back to get()/409.
  // This closes the check-then-set race where two requests both read null and both proceed.
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await redisClient.set(`${KEY_PREFIX}${key}`, PENDING_SENTINEL, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  // Drops a claimed-but-failed key so the client can retry the same idempotency key. Only the
  // owner reaches this (it ran inside the claim), so a plain DEL is safe.
  async release(key: string): Promise<void> {
    await redisClient.del(`${KEY_PREFIX}${key}`);
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
    // Plain SET EX (no NX) — intentionally overwrites the "pending" sentinel from claim().
    await redisClient.set(`${KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }
}

export const IdempotencyRepository = new _IdempotencyRepository();
