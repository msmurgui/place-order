import { randomUUID } from 'crypto';
import { redisClient } from '../redis';

// Atomically releases the lock only if the token still matches — prevents
// releasing a lock that expired and was re-acquired by another holder.
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

// Prevents concurrent processes from interleaving a read-check-then-write
// sequence on the same resource key. 
// For example, two simultaneous orders checking
// available inventory for the same product before either has reserved stock.
class _DistributedLockService {
  async acquire({ key, ttlMs }: { key: string; ttlMs: number }): Promise<string | null> {
    const token = randomUUID();
    const result = await redisClient.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release({ key, token }: { key: string; token: string }): Promise<void> {
    await redisClient.eval(RELEASE_SCRIPT, 1, key, token);
  }
}

export const DistributedLockService = new _DistributedLockService();
