/**
 * `Omit` over a union collapses to the keys common to every member, which would erase
 * each auth arm's own fields. Distributing keeps both shapes intact.
 */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Which authentication method a connection uses. */
export type AuthType = "tba" | "m2m";

/** Fields every connection carries, whichever auth method it uses. */
interface BaseConnectionProfile {
  id: string;
  label: string;
  realm: string;
  /** RESTlet deployment URL backing schema discovery. Unset = discovery is disabled — see `restletSchemaDiscovery.ts`. */
  restletUrl?: string;
  /**
   * Complete http(s) URL of a mock or proxy server to talk to instead of the host derived
   * from `realm` (SuiteQL, token endpoint). Unset = the real NetSuite account host.
   */
  baseUrlOverride?: string;
}

/** OAuth 1.0a Token-Based Authentication. Secrets live in SecretStorage, never here. */
export interface TbaConnectionProfile extends BaseConnectionProfile {
  /**
   * Absent on every profile saved before M2M support existed, so a missing value has to
   * keep meaning TBA — read it through {@link getAuthType} rather than directly.
   */
  authType?: "tba";
  consumerKey: string;
  tokenKey: string;
}

/** OAuth 2.0 Client Credentials (machine-to-machine). The private key lives in SecretStorage. */
export interface M2mConnectionProfile extends BaseConnectionProfile {
  authType: "m2m";
  clientId: string;
  certificateId: string;
  /** Omitted means the library's default (PS256). NetSuite rejects RS256. */
  jwtAlgorithm?: JwtAlgorithm;
}

/** Non-secret, settings.json-persisted shape of a saved connection. */
export type ConnectionProfile = TbaConnectionProfile | M2mConnectionProfile;

/**
 * JWT signing algorithms NetSuite accepts for an M2M certificate, in the order the
 * dialog offers them. PS256 (RSASSA-PSS) is NetSuite's expected default for an RSA
 * certificate; the ES* variants are for an EC one. RS256 is deliberately absent —
 * NetSuite rejects it, and the library's config schema does too.
 */
export const JWT_ALGORITHMS = ["PS256", "PS384", "PS512", "ES256", "ES384", "ES512"] as const;

export type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number];

export const DEFAULT_JWT_ALGORITHM: JwtAlgorithm = "PS256";

/** Narrows an arbitrary string (a hand-edited setting, a webview message) to a supported algorithm. */
export function toJwtAlgorithm(value: string | undefined): JwtAlgorithm | undefined {
  return JWT_ALGORITHMS.find((algorithm) => algorithm === value);
}

/** A profile saved before M2M support has no `authType`; that absence means TBA. */
export function getAuthType(profile: { authType?: AuthType }): AuthType {
  return profile.authType ?? "tba";
}

/** Narrows to the M2M arm — `getAuthType(...) === "m2m"` can't do that on its own. */
export function isM2mProfile(profile: ConnectionProfile): profile is M2mConnectionProfile {
  return profile.authType === "m2m";
}

/** What the "Add Connection" flow collects, before it's split into profile + secrets. */
export interface TbaConnectionProfileInput {
  authType?: "tba";
  label: string;
  realm: string;
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
  restletUrl?: string;
  baseUrlOverride?: string;
}

export interface M2mConnectionProfileInput {
  authType: "m2m";
  label: string;
  realm: string;
  clientId: string;
  certificateId: string;
  /** PEM content, pasted or read from a file host-side. The file path is never persisted. */
  privateKey: string;
  jwtAlgorithm?: JwtAlgorithm;
  restletUrl?: string;
  baseUrlOverride?: string;
}

export type ConnectionProfileInput = TbaConnectionProfileInput | M2mConnectionProfileInput;

export function isM2mInput(input: ConnectionProfileInput): input is M2mConnectionProfileInput {
  return input.authType === "m2m";
}

export function toConnectionProfile(id: string, input: ConnectionProfileInput): ConnectionProfile {
  if (isM2mInput(input)) {
    return {
      id,
      authType: "m2m",
      label: input.label,
      realm: input.realm,
      clientId: input.clientId,
      certificateId: input.certificateId,
      jwtAlgorithm: input.jwtAlgorithm,
      restletUrl: input.restletUrl,
      ...(input.baseUrlOverride ? { baseUrlOverride: input.baseUrlOverride } : {}),
    };
  }
  return {
    id,
    authType: "tba",
    label: input.label,
    realm: input.realm,
    consumerKey: input.consumerKey,
    tokenKey: input.tokenKey,
    restletUrl: input.restletUrl,
    ...(input.baseUrlOverride ? { baseUrlOverride: input.baseUrlOverride } : {}),
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

/**
 * Validates the optional server URL override, for the dialog and the "Set Server URL"
 * command alike. Mirrors the library's rule so a bad value is caught here with a clear
 * message rather than as a config error later: a complete http(s) URL, no query string,
 * fragment or credentials. Plain http is allowed — the point is a local mock.
 */
export function validateBaseUrlOverride(value: string | undefined): string | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Server URL is not a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Server URL must be an http:// or https:// URL.";
  }
  if (url.username || url.password) {
    return "Server URL must not contain credentials.";
  }
  if (url.search || url.hash || /[?#]/.test(value)) {
    return "Server URL must not contain a query string or fragment.";
  }
  return undefined;
}
