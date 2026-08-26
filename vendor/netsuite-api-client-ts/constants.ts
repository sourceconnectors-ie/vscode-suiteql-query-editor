export const SUITEQL_BASE_PATH = "/services/rest/query/v1/suiteql";
export const METADATA_CATALOG_BASE_PATH = "/services/rest/record/v1/metadata-catalog";

export const DEFAULT_QUERY_TIMEOUT = 300;
export const DEFAULT_LIMIT = 1000;
export const DEFAULT_MAX_OFFSET = 1_000_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_RETRY_DELAY = 2.0;
export const DEFAULT_MAX_CONCURRENT_QUERIES = 3;
export const DEFAULT_QUERY_DELAY = 1.0;

export const RETRYABLE_STATUS_CODES: readonly number[] = [429, 500, 502, 503, 504];
