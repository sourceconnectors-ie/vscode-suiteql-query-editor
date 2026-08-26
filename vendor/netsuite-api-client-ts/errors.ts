/** Base class for all errors raised by this library. */
export class SuiteQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConfigurationError extends SuiteQLError {}

export class SuiteQLConnectionError extends SuiteQLError {}

/** Thrown by {@link SchemaDiscovery} when the metadata-catalog API returns an error body or an unrecognized shape. */
export class SchemaDiscoveryError extends SuiteQLError {}

interface NetSuiteErrorBody {
  type?: string;
  title?: string;
  status?: number;
  "o:errorDetails"?: Array<{
    detail?: string;
    "o:errorQueryParam"?: string;
    "o:errorCode"?: string;
  }>;
}

/**
 * Extracts NetSuite's own error message from its structured JSON error body
 * (`o:errorDetails[0].detail`) when present, falling back to a generic message.
 */
function extractNetSuiteMessage(rawBody: string, fallback: string): string {
  try {
    const data = JSON.parse(rawBody) as NetSuiteErrorBody;
    const detail = data["o:errorDetails"]?.[0]?.detail;
    return detail || fallback;
  } catch {
    return fallback;
  }
}

/** Generic HTTP error from a SuiteQL request; retry decisions key off `statusCode`, not this class. */
export class SuiteQLHttpError extends SuiteQLError {
  readonly statusCode: number;
  readonly retryAfter: string | null;

  constructor(
    statusCode: number,
    fallbackMessage: string,
    options: { retryAfter?: string | null; rawBody?: string } = {},
  ) {
    const message = options.rawBody
      ? extractNetSuiteMessage(options.rawBody, fallbackMessage)
      : fallbackMessage;
    super(message);
    this.statusCode = statusCode;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export class RateLimitError extends SuiteQLHttpError {}
export class UnauthorizedError extends SuiteQLHttpError {}
export class NotFoundError extends SuiteQLHttpError {}
export class InternalServerError extends SuiteQLHttpError {}
export class ServiceUnavailableError extends SuiteQLHttpError {}

const STATUS_ERROR_CLASSES: Record<number, new (...args: ConstructorParameters<typeof SuiteQLHttpError>) => SuiteQLHttpError> = {
  429: RateLimitError,
  401: UnauthorizedError,
  404: NotFoundError,
  500: InternalServerError,
  503: ServiceUnavailableError,
};

export function createHttpError(
  statusCode: number,
  fallbackMessage: string,
  options: { retryAfter?: string | null; rawBody?: string } = {},
): SuiteQLHttpError {
  const ErrorClass = STATUS_ERROR_CLASSES[statusCode] ?? SuiteQLHttpError;
  return new ErrorClass(statusCode, fallbackMessage, options);
}

export interface BatchQueryFailure {
  query: string;
  error: string;
}

/**
 * Thrown by `SuiteQLConnector.readQueries` after yielding every record from the
 * queries that succeeded, if one or more queries in the batch failed. One query
 * failing never aborts its siblings, but the failure is never silently dropped.
 */
export class SuiteQLBatchError extends SuiteQLError {
  readonly failures: BatchQueryFailure[];

  constructor(failures: BatchQueryFailure[]) {
    const summary = failures
      .map((f) => `"${f.query.slice(0, 80)}": ${f.error}`)
      .join("; ");
    super(`${failures.length} quer${failures.length === 1 ? "y" : "ies"} failed: ${summary}`);
    this.failures = failures;
  }
}
