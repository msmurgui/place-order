import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../config/env', () => ({ env: { RATE_LIMIT_MAX: 5, RATE_LIMIT_WINDOW_SECONDS: 60 } }));
vi.mock('../util/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../redis', () => ({ redisClient: { eval: vi.fn() } }));

import { redisClient } from '../redis';
import { rateLimiter } from './rateLimiter';

const buildRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildReq = (ip: string | undefined): Request => ({ ip }) as Request;

let next: NextFunction;

beforeEach(() => {
  next = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('rateLimiter', () => {
  it('calls next when under the limit', async () => {
    vi.mocked(redisClient.eval).mockResolvedValue(1);
    const res = buildRes();

    await rateLimiter(buildReq('1.2.3.4'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 429 without calling next when over the limit', async () => {
    vi.mocked(redisClient.eval).mockResolvedValue(0);
    const res = buildRes();

    await rateLimiter(buildReq('1.2.3.4'), res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' });
    expect(next).not.toHaveBeenCalled();
  });

  it('skips rate limiting (and Redis) when the client IP is missing', async () => {
    const res = buildRes();

    await rateLimiter(buildReq(undefined), res, next);

    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails open (allows the request) when Redis errors', async () => {
    vi.mocked(redisClient.eval).mockRejectedValue(new Error('redis down'));
    const res = buildRes();

    await rateLimiter(buildReq('1.2.3.4'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('keys the limit on the client IP', async () => {
    vi.mocked(redisClient.eval).mockResolvedValue(1);

    await rateLimiter(buildReq('9.9.9.9'), buildRes(), next);

    expect(vi.mocked(redisClient.eval).mock.calls[0]).toContain('ratelimit:9.9.9.9');
  });
});
