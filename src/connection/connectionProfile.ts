/** Non-secret, settings.json-persisted shape of a saved connection. */
export interface ConnectionProfile {
  id: string;
  label: string;
  realm: string;
  consumerKey: string;
  tokenKey: string;
  /** RESTlet deployment URL backing schema discovery. Unset = discovery is disabled — see `restletSchemaDiscovery.ts`. */
  restletUrl?: string;
}

/** What the "Add Connection" flow collects before splitting it into profile + secrets. */
export interface ConnectionProfileInput {
  label: string;
  realm: string;
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
  restletUrl?: string;
}

export function toConnectionProfile(id: string, input: ConnectionProfileInput): ConnectionProfile {
  return {
    id,
    label: input.label,
    realm: input.realm,
    consumerKey: input.consumerKey,
    tokenKey: input.tokenKey,
    restletUrl: input.restletUrl,
  };
}

/**
 * Shared between adding a connection and the "Set RESTlet URL" command, so both paths
 * reject the same malformed/non-https input instead of only one of them enforcing it.
 * An empty/unset value is always valid — clearing/omitting the (optional) RESTlet URL is
 * allowed.
 */
export function validateRestletUrl(value: string | undefined): string | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? undefined : "RESTlet URL must be an https:// URL.";
  } catch {
    return "RESTlet URL is not a valid URL.";
  }
}
