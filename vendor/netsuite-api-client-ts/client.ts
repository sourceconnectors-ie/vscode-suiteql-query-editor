import type OAuth from "oauth-1.0a";
import { getSuiteQLUrl, type SuiteQLConfig } from "./config.js";
import { RETRYABLE_STATUS_CODES } from "./constants.js";
import { createHttpError, SuiteQLError, SuiteQLHttpError } from "./errors.js";
import { createOAuthClient, getAuthorizationHeader } from "./oauth1.js";
import { calculateBackoff, getRetryDelay, sleep } from "./retry.js";

export interface SuiteQLQueryResult {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
  count: number;
  offset: number;
  totalResults: number;
}

export interface RetryStats {
  totalRetries: number;
  byStatusCode: Record<string, number>;
}

export interface ConnectionCheckResult {
  success: boolean;
  error?: string;
}

/**
 * Client for the NetSuite SuiteQL REST endpoint: OAuth1 signing, request execution,
 * and application-level retry.
 */
export class SuiteQLClient {
  private readonly config: SuiteQLConfig;
  private readonly oauth: OAuth;
  private readonly suiteqlUrl: string;
  private readonly retryStats = new Map<number, number>();
  private totalRetries = 0;

  constructor(config: SuiteQLConfig) {
    this.config = config;
    this.oauth = createOAuthClient(config);
    this.suiteqlUrl = getSuiteQLUrl(config);
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    try {
      await this.executeQuery("SELECT id FROM transaction", 1, 0);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Executes a SuiteQL query with retry: retries on `RETRYABLE_STATUS_CODES` and on
   * network/timeout errors, up to `maxRetries` times, honoring `Retry-After`, then throws.
   */
  async executeQuery(
    query: string,
    limit?: number,
    offset = 0,
  ): Promise<SuiteQLQueryResult> {
    const effectiveLimit = limit ?? this.config.defaultLimit;

    if (offset > this.config.maxOffset) {
      throw new SuiteQLError(`Offset ${offset} exceeds max_offset ${this.config.maxOffset}`);
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.executeRequest(query, effectiveLimit, offset);
      } catch (error) {
        const isLastAttempt = attempt >= this.config.maxRetries;

        if (error instanceof SuiteQLHttpError) {
          if (!RETRYABLE_STATUS_CODES.includes(error.statusCode) || isLastAttempt) {
            throw error;
          }
          this.recordRetry(error.statusCode);
          await sleep(getRetryDelay(attempt, this.config.initialRetryDelay, error.retryAfter));
          continue;
        }

        // Network/timeout errors (fetch throws TypeError, or AbortError on timeout).
        if (isLastAttempt) {
          throw error;
        }
        this.recordRetry(0);
        await sleep(calculateBackoff(attempt, this.config.initialRetryDelay));
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new SuiteQLError(`Query execution failed after ${this.config.maxRetries + 1} attempts`);
  }

  private async executeRequest(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SuiteQLQueryResult> {
    const url = `${this.suiteqlUrl}?limit=${limit}&offset=${offset}`;
    const authorization = getAuthorizationHeader(
      this.oauth,
      { key: this.config.tokenKey, secret: this.config.tokenSecret },
      url,
      "POST",
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "transient",
          Authorization: authorization,
        },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(this.config.queryTimeout * 1000),
      });
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      throw createHttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, {
        retryAfter: response.headers.get("Retry-After"),
        rawBody,
      });
    }

    return (await response.json()) as SuiteQLQueryResult;
  }

  private recordRetry(statusCode: number): void {
    this.totalRetries += 1;
    this.retryStats.set(statusCode, (this.retryStats.get(statusCode) ?? 0) + 1);
  }

  getRetryStats(): RetryStats {
    return {
      totalRetries: this.totalRetries,
      byStatusCode: Object.fromEntries(
        Array.from(this.retryStats.entries()).map(([code, count]) => [String(code), count]),
      ),
    };
  }

  resetRetryStats(): void {
    this.retryStats.clear();
    this.totalRetries = 0;
  }
}
