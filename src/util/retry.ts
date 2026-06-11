function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `fn` up to `attempts` times, waiting `delayMs` between each try.
 * Throws the last error if all attempts are exhausted.
 */
export async function withRetry<T>({
  fn,
  attempts,
  delayMs,
}: {
  fn: () => Promise<T>;
  attempts: number;
  delayMs: number;
}): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await delay(delayMs);
    }
  }

  throw lastError;
}
