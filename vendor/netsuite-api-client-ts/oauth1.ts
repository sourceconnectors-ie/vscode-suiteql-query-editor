import crypto from "node:crypto";
// oauth-1.0a is a CJS module exported via `export =`; esModuleInterop gives us a default import.
import OAuth from "oauth-1.0a";
import type { SuiteQLConfig } from "./config.js";

/**
 * Builds the `oauth-1.0a` client for HMAC-SHA256 signing, with the realm included
 * in the Authorization header.
 */
export function createOAuthClient(
  credentials: Pick<SuiteQLConfig, "realm" | "consumerKey" | "consumerSecret">,
): OAuth {
  return new OAuth({
    consumer: { key: credentials.consumerKey, secret: credentials.consumerSecret },
    realm: credentials.realm,
    signature_method: "HMAC-SHA256",
    hash_function(baseString: string, key: string) {
      return crypto.createHmac("sha256", key).update(baseString).digest("base64");
    },
  });
}

/**
 * Signs a request and returns the `Authorization` header value.
 *
 * `request.data` is left undefined here — `oauth-1.0a` only folds it into the
 * signature's parameter string when explicitly provided, and NetSuite's JSON body
 * must never be part of the signature. Pagination params (`limit`/`offset`) must
 * instead be part of `url`'s query string.
 */
export function getAuthorizationHeader(
  oauth: OAuth,
  token: { key: string; secret: string },
  url: string,
  method: string,
): string {
  const authorized = oauth.authorize({ url, method }, token);
  return oauth.toHeader(authorized).Authorization;
}
