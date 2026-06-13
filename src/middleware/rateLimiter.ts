import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { redisClient } from '../redis';
import { logger } from '../util/logger';

const WINDOW_MS = env.RATE_LIMIT_WINDOW_SECONDS * 1_000;
const MAX_REQUESTS = env.RATE_LIMIT_MAX;

// Atomic sliding-window-log limiter: evict entries older than the window, count what
// remains, and record the new request only if it's under the limit. Doing all of it in
// one Lua script avoids the check-then-write race two concurrent requests would otherwise
// hit. Returns 1 if allowed, 0 if rate-limited.
const SLIDING_WINDOW_SCRIPT = `
  local windowStart = tonumber(ARGV[1]) - tonumber(ARGV[2])
  redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, windowStart)
  local count = redis.call("ZCARD", KEYS[1])
  if count >= tonumber(ARGV[3]) then
    return 0
  end
  redis.call("ZADD", KEYS[1], ARGV[1], ARGV[4])
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  return 1
`;

export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const customerId = (req.body as { customerId?: unknown })?.customerId;

  // The limit keys on customerId. If it's missing or malformed, skip — schema validation
  // runs next in the pipeline and will reject the request.
  if (typeof customerId !== 'number') {
    next();
    return;
  }

  const key = `ratelimit:${customerId}`;
  const now = Date.now();

  try {
    const allowed = await redisClient.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now.toString(),
      WINDOW_MS.toString(),
      MAX_REQUESTS.toString(),
      `${now}-${randomUUID()}`
    );

    if (allowed === 0) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    next();
  } catch (err) {
    // Fail open — a Redis hiccup should not take down the endpoint. Log and allow through.
    logger.warn({ err, customerId }, 'rate limiter unavailable — allowing request');
    next();
  }
};
