export {
  getBaseUrl,
  getMetadataCatalogUrl,
  getSuiteQLUrl,
  maskSensitiveFields,
  normalizeRealm,
  parseSuiteQLConfig,
  SuiteQLConfigSchema,
  type SuiteQLConfig,
  type SuiteQLConfigInput,
} from "./config.js";

export {
  ConfigurationError,
  createHttpError,
  InternalServerError,
  NotFoundError,
  OperationCancelledError,
  RateLimitError,
  SchemaDiscoveryError,
  ServiceUnavailableError,
  SuiteQLBatchError,
  SuiteQLConnectionError,
  SuiteQLError,
  SuiteQLHttpError,
  UnauthorizedError,
  type BatchQueryFailure,
} from "./errors.js";

export { SuiteQLClient, type ConnectionCheckResult, type RetryStats, type SuiteQLQueryResult } from "./client.js";

export { RestletClient, type RestletCallOptions } from "./restlet-client.js";

export {
  readRecords,
  type ExtractionStatus,
  type ExtractionSummary,
  type StopReason,
  type StreamState,
} from "./stream.js";

export {
  SuiteQLConnector,
  type CheckConnectionResult,
  type DiscoverResult,
  type ReadOptions,
  type SuiteQLRecord,
} from "./connector.js";

export {
  SchemaDiscovery,
  type FieldSchema,
  type RecordSchema,
  type RecordTypeInfo,
  type RelationshipSchema,
} from "./schema-discovery.js";

export {
  buildFieldTypeMap,
  coerceRow,
  getUnmappedColumns,
  normalizeCoercibleType,
  type CoerceOptions,
  type CoercibleType,
  type FieldTypeInfo,
} from "./coerce.js";

export { splitSqlStatements } from "./sql.js";

export { Semaphore } from "./semaphore.js";
