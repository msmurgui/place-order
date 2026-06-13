import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Mock the orders router - this suite is just testing the wiring of the app
vi.mock('./routes/orders', () => ({
  ordersRouter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createApp } from './app';

const app = createApp();

describe('app wiring', () => {
  it('serves the health check', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
