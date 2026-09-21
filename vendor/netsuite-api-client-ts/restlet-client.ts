import type OAuth from "oauth-1.0a";
import type { SuiteQLConfig } from "./config.js";
import { RETRYABLE_STATUS_CODES } from "./constants.js";
import { createHttpError, OperationCancelledError, SuiteQLError, SuiteQLHttpError } from "./errors.js";
import { createOAuthClient, getAuthorizationHeader } from "./oauth1.js";
import { calculateBackoff, getRetryDelay, sleep } from "./retry.js";

export interface RestletCallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Aborts the in-flight request and stops further retries. Checked before each attempt
   * and during backoff waits, so cancelling doesn't wait out a queued retry delay.
   */
  signal?: AbortSignal;
}

/**
 * Signs and calls an arbitrary NetSuite RESTlet deployment URL — not tied to any
 * particular RESTlet's business logic or response shape. Shares OAuth1 signing
 * (`oauth1.ts`), retry-on-`RETRYABLE_STATUS_CODES`-or-network-error (`retry.ts`), and
 * typed HTTP errors (`errors.ts`) with {@link SuiteQLClient}, so a RESTlet call fails
 * and retries the same way a SuiteQL call does. Callers own the wire contract of
 * whichever RESTlet they're calling; this class only owns getting a signed request
 * there and a parsed JSON response back.
 */
export class RestletClient {
  private readonly config: SuiteQLConfig;
  private readonly oauth: OAuth;

  constructor(config: SuiteQLConfig) {
    this.config = config;
    this.oauth = createOAuthClient(config);
  }

  async call<T = unknown>(url: string, options: RestletCallOptions = {}): Promise<T> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (options.signal?.aborted) {
        throw new OperationCancelledError("RESTlet call cancelled");
      }
      try {
        return await this.executeRequest<T>(url, options);
      } catch (error) {
        if (error instanceof OperationCancelledError) {
          throw error;
        }
        const isLastAttempt = attempt >= this.config.maxRetries;

        if (error instanceof SuiteQLHttpError) {
          if (!RETRYABLE_STATUS_CODES.includes(error.statusCode) || isLastAttempt) {
            throw error;
          }
          await sleep(getRetryDelay(attempt, this.config.initialRetryDelay, error.retryAfter), options.signal);
          continue;
        }

        if (isLastAttempt) {
          throw error;
        }
        await sleep(calculateBackoff(attempt, this.config.initialRetryDelay), options.signal);
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new SuiteQLError(`RESTlet call failed after ${this.config.maxRetries + 1} attempts`);
  }

  private async executeRequest<T>(url: string, options: RestletCallOptions): Promise<T> {
    const method = options.method ?? "GET";
    const authorization = getAuthorizationHeader(
      this.oauth,
      { key: this.config.tokenKey, secret: this.config.tokenSecret },
      url,
      method,
    );

    const timeoutSignal = AbortSignal.timeout(this.config.queryTimeout * 1000);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          // Always sent, even on a bodyless GET: NetSuite's RESTlet dispatcher decides
          // whether to JSON-serialize a non-string return value based on the *request's*
          // Content-Type — omit it and a RESTlet returning an object fails with NetSuite's
          // own `INVALID_RETURN_DATA_FORMAT` ("Invalid data format. You should return
          // text."), confirmed empirically against a live RESTlet.
          "Content-Type": "application/json",
          Authorization: authorization,
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal,
      });
    } catch (cause) {
      // The merged signal doesn't say *which* member fired — check the caller's own
      // signal specifically, since a timeout abort must stay retryable.
      if (options.signal?.aborted) {
        throw new OperationCancelledError("RESTlet call cancelled");
      }
      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      throw createHttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, {
        retryAfter: response.headers.get("Retry-After"),
        rawBody,
      });
    }

    return (await response.json()) as T;
  }
}
