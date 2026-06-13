import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitOpenError } from '../util/errors';

vi.mock('../redis', () => ({ redisClient: { get: vi.fn() } }));

import { redisClient } from '../redis';
import { assertCircuitClosed, isCircuitOpen } from './circuitBreaker';

afterEach(() => {
  vi.clearAllMocks();
});

describe('isCircuitOpen', () => {
  it('returns true when the flag is "1"', async () => {
    vi.mocked(redisClient.get).mockResolvedValue('1');

    expect(await isCircuitOpen('payment')).toBe(true);
    expect(redisClient.get).toHaveBeenCalledWith('circuit:payment');
  });

  it('returns false when the flag is absent', async () => {
    vi.mocked(redisClient.get).mockResolvedValue(null);

    expect(await isCircuitOpen('tax')).toBe(false);
  });

  it('returns false for any non-"1" value', async () => {
    vi.mocked(redisClient.get).mockResolvedValue('0');

    expect(await isCircuitOpen('geocoding')).toBe(false);
  });
});

describe('assertCircuitClosed', () => {
  it('throws CircuitOpenError when the circuit is open', async () => {
    vi.mocked(redisClient.get).mockResolvedValue('1');

    await expect(assertCircuitClosed('payment')).rejects.toThrow(CircuitOpenError);
  });

  it('resolves when the circuit is closed', async () => {
    vi.mocked(redisClient.get).mockResolvedValue(null);

    await expect(assertCircuitClosed('payment')).resolves.toBeUndefined();
  });
});
