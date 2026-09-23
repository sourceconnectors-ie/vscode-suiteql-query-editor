/**
 * Zero-dependency async concurrency limiter. Bounds how many SuiteQL queries (or
 * metadata-catalog requests) run concurrently, mirroring NetSuite's own
 * concurrent-REST-call ceiling.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be at least 1");
    }
    this.available = maxConcurrent;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    // The releasing holder hands its permit straight to us (see `release`) — `available`
    // is never bumped in between, so a new caller can't slip in and take it first.
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
