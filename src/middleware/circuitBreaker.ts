import { redisClient } from '../redis';
import { CircuitOpenError } from '../util/errors';

export type CircuitName = 'geocoding' | 'payment' | 'tax';

// Redis-backed boolean flags, one per external dependency. '1' = open (failing).
// Flags are toggled manually via ops tooling or automatically after an error threshold.
const flagKey = (name: CircuitName): string => `circuit:${name}`;

export const isCircuitOpen = async (name: CircuitName): Promise<boolean> => {
  return (await redisClient.get(flagKey(name))) === '1';
};

// Throws CircuitOpenError (→ 503) if the circuit is open. Call immediately before the gateway call.
export const assertCircuitClosed = async (name: CircuitName): Promise<void> => {
  if (await isCircuitOpen(name)) {
    throw new CircuitOpenError(name);
  }
};
