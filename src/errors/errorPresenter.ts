import {
  ConfigurationError,
  RateLimitError,
  SuiteQLConnectionError,
  SuiteQLHttpError,
  UnauthorizedError,
} from "@monty-nabil/netsuite-api-client-ts";
import type { AuthType } from "../connection/connectionProfile.js";

/**
 * Turns a caught error from the library into a short, user-facing message.
 *
 * `authType` steers the authentication advice: pointing an OAuth 2.0 connection at its
 * "consumer/token keys" describes fields it doesn't have, and sends the user looking in
 * the wrong place.
 */
export function presentError(error: unknown, authType: AuthType = "tba"): string {
  if (error instanceof UnauthorizedError) {
    if (authType === "m2m") {
      return (
        "Authentication failed — check the connection's client ID, certificate ID, and private key, " +
        "and that the integration record grants both the rest_webservices and restlets scopes. " +
        `(${error.message})`
      );
    }
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
