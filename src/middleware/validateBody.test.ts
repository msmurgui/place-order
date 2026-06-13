import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from './validateBody';

const schema = z.object({ name: z.string().min(1) });

const buildRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

let next: NextFunction;

beforeEach(() => {
  next = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('validateBody', () => {
  it('calls next and replaces req.body with parsed data when valid', () => {
    const req = { body: { name: 'Ada', extra: 'stripped' } } as Request;
    const res = buildRes();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // Unknown keys are stripped, leaving the known-good shape.
    expect(req.body).toEqual({ name: 'Ada' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 400 and does not call next when invalid', () => {
    const req = { body: { name: '' } } as Request;
    const res = buildRes();

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid request body' }));
    expect(next).not.toHaveBeenCalled();
  });
});
