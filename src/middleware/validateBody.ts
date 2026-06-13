import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

// Validates req.body against a Zod schema before the controller runs. On success it
// replaces req.body with the parsed (and stripped/coerced) data so downstream handlers
// work with a known-good shape; on failure it short-circuits with 400.
export const validateBody = (schema: ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request body', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
};
