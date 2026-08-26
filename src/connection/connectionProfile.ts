/** Non-secret, settings.json-persisted shape of a saved connection. */
export interface ConnectionProfile {
  id: string;
  label: string;
  realm: string;
  consumerKey: string;
  tokenKey: string;
}

/** What the "Add Connection" flow collects before splitting it into profile + secrets. */
export interface ConnectionProfileInput {
  label: string;
  realm: string;
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
}

export function toConnectionProfile(id: string, input: ConnectionProfileInput): ConnectionProfile {
  return {
    id,
    label: input.label,
    realm: input.realm,
    consumerKey: input.consumerKey,
    tokenKey: input.tokenKey,
  };
}
