import {
  ConfigurationError,
  RateLimitError,
  SuiteQLConnectionError,
  SuiteQLHttpError,
  UnauthorizedError,
} from "../../vendor/netsuite-api-client-ts/index.js";

/** Turns a caught error from the vendored library into a short, user-facing message. */
export function presentError(error: unknown): string {
  if (error instanceof UnauthorizedError) {
    return `Authentication failed — check the connection's consumer/token keys and secrets. (${error.message})`;
  }
  if (error instanceof RateLimitError) {
    return `NetSuite rate-limited this request — try again shortly. (${error.message})`;
  }
  if (error instanceof ConfigurationError) {
    return `Invalid connection configuration: ${error.message}`;
  }
  if (error instanceof SuiteQLConnectionError) {
    return `Could not reach NetSuite: ${error.message}`;
  }
  if (error instanceof SuiteQLHttpError) {
    return `NetSuite returned an error (HTTP ${error.statusCode}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
