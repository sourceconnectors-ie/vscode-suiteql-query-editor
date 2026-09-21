import { OperationCancelledError } from "./errors.js";

/**
 * Exponential backoff with additive jitter, uncapped:
 * `initial_delay * 2**attempt + random.uniform(0, 1)`.
 *
 * `random` is injectable purely for deterministic tests; production callers omit it.
 */
export function calculateBackoff(
  attempt: number,
  initialRetryDelay: number,
  random: () => number = Math.random,
): number {
  const baseDelay = initialRetryDelay * 2 ** attempt;
  const jitter = random();
  return baseDelay + jitter;
}

/**
 * Resolves the delay before the next retry, honoring a `Retry-After` header if present:
 * numeric seconds first, then an HTTP-date, falling through to computed backoff on any
 * parse failure — this must never throw.
 */
export function getRetryDelay(
  attempt: number,
  initialRetryDelay: number,
  retryAfterHeader: string | null | undefined,
  random: () => number = Math.random,
): number {
  if (retryAfterHeader) {
    const asSeconds = Number(retryAfterHeader);
    if (Number.isFinite(asSeconds)) {
      return asSeconds;
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, (asDate - Date.now()) / 1000);
    }
  }
  return calculateBackoff(attempt, initialRetryDelay, random);
}

/**
 * Waits `seconds`, or rejects with {@link OperationCancelledError} as soon as `signal`
 * aborts — a caller cancelling mid-backoff must not sit through the rest of the wait.
 */
export function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new OperationCancelledError("Operation cancelled"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, seconds * 1000);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OperationCancelledError("Operation cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
