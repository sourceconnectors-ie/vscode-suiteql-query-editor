import { z } from "zod";
import {
  DEFAULT_INITIAL_RETRY_DELAY,
  DEFAULT_LIMIT,
  DEFAULT_MAX_CONCURRENT_QUERIES,
  DEFAULT_MAX_OFFSET,
  DEFAULT_MAX_RETRIES,
  DEFAULT_QUERY_DELAY,
  DEFAULT_QUERY_TIMEOUT,
  METADATA_CATALOG_BASE_PATH,
  SUITEQL_BASE_PATH,
} from "./constants.js";
import { ConfigurationError } from "./errors.js";

/** Hyphens -> underscores, uppercase. */
export function normalizeRealm(realm: string): string {
  return realm.replace(/-/g, "_").toUpperCase();
}

export const SuiteQLConfigSchema = z.object({
  realm: z.string().min(1, "realm is required").transform(normalizeRealm),
  consumerKey: z.string().min(1, "consumerKey is required"),
  consumerSecret: z.string().min(1, "consumerSecret is required"),
  tokenKey: z.string().min(1, "tokenKey is required"),
  tokenSecret: z.string().min(1, "tokenSecret is required"),

  queryTimeout: z.number().int().min(30).max(600).default(DEFAULT_QUERY_TIMEOUT),
  defaultLimit: z.number().int().min(1).max(10_000).default(DEFAULT_LIMIT),
  maxOffset: z.number().int().min(1).max(10_000_000).default(DEFAULT_MAX_OFFSET),

  maxRetries: z.number().int().min(0).max(10).default(DEFAULT_MAX_RETRIES),
  initialRetryDelay: z.number().min(0.1).max(60.0).default(DEFAULT_INITIAL_RETRY_DELAY),

  maxConcurrentQueries: z.number().int().min(1).max(10).default(DEFAULT_MAX_CONCURRENT_QUERIES),
  queryDelay: z.number().min(0).max(10.0).default(DEFAULT_QUERY_DELAY),
});

export type SuiteQLConfigInput = z.input<typeof SuiteQLConfigSchema>;
export type SuiteQLConfig = z.output<typeof SuiteQLConfigSchema>;

/**
 * Parses and validates raw config input. Throws {@link ConfigurationError} on failure,
 * with all validation issues joined into a single readable message.
 */
export function parseSuiteQLConfig(raw: unknown): SuiteQLConfig {
  const result = SuiteQLConfigSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigurationError(`Invalid SuiteQL configuration: ${message}`);
  }
  return result.data;
}

/** Base URL subdomain is a hyphen+lowercase derivation of the *stored* (normalized) realm. */
export function getBaseUrl(config: Pick<SuiteQLConfig, "realm">): string {
  const subdomain = config.realm.replace(/_/g, "-").toLowerCase();
  return `https://${subdomain}.suitetalk.api.netsuite.com`;
}

export function getSuiteQLUrl(config: Pick<SuiteQLConfig, "realm">): string {
  return `${getBaseUrl(config)}${SUITEQL_BASE_PATH}`;
}

export function getMetadataCatalogUrl(config: Pick<SuiteQLConfig, "realm">): string {
  return `${getBaseUrl(config)}${METADATA_CATALOG_BASE_PATH}`;
}

/** Returns a copy of the config with secrets masked, safe for logging. */
export function maskSensitiveFields(config: SuiteQLConfig): Record<string, unknown> {
  return {
    ...config,
    consumerSecret: "***MASKED***",
    tokenSecret: "***MASKED***",
  };
}
