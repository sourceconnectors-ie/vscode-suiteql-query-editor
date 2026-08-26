import { SuiteQLClient } from "./client.js";
import type { CoercibleType } from "./coerce.js";
import { buildFieldTypeMap, coerceRow, getUnmappedColumns } from "./coerce.js";
import type { SuiteQLConfig } from "./config.js";
import { SuiteQLBatchError, SuiteQLError, type BatchQueryFailure } from "./errors.js";
import { SchemaDiscovery, type RecordSchema } from "./schema-discovery.js";
import { Semaphore } from "./semaphore.js";
import { readRecords, type ExtractionSummary, type StreamState } from "./stream.js";

export interface SuiteQLRecord {
  stream: "suiteql";
  data: Record<string, unknown>;
  emittedAt: number;
}

export interface ReadOptions {
  /**
   * Enables schema-driven value coercion for this query: fetches the record type's
   * field metadata once (before the first yielded record) and converts each row's
   * string values to numbers/booleans accordingly. Best-effort for simple,
   * effectively-single-table queries — joins/aliases/aggregates will have columns
   * the schema doesn't cover, which are passed through unchanged. Mutually exclusive
   * with `schema` — only one way of supplying a schema may be given.
   */
  recordType?: string;
  /**
   * Enables the same coercion as `recordType`, but from an already-loaded schema
   * instead of fetching one from NetSuite — no metadata-catalog network call is made.
   * Mutually exclusive with `recordType`.
   */
  schema?: RecordSchema;
  /** Forces specific columns (case-insensitive) to a given type, overriding the schema-derived type. */
  coerceOverrides?: Partial<Record<string, CoercibleType>>;
  onCoercionWarning?: (message: string, details: Record<string, unknown>) => void;
}

export interface CheckConnectionResult {
  status: "success" | "failed";
  message: string;
}

export interface DiscoverResult {
  connector: string;
  description: string;
  capabilities: string[];
  supportedSyncModes: string[];
}

export class SuiteQLConnector {
  private readonly client: SuiteQLClient;
  private schemaDiscovery: SchemaDiscovery | undefined;

  constructor(private readonly config: SuiteQLConfig) {
    this.client = new SuiteQLClient(config);
  }

  async checkConnection(): Promise<CheckConnectionResult> {
    const result = await this.client.checkConnection();
    return result.success
      ? { status: "success", message: "Connection successful" }
      : { status: "failed", message: result.error ?? "Unknown error" };
  }

  discover(): DiscoverResult {
    return {
      connector: "netsuite_suiteql",
      description: "Execute arbitrary SuiteQL queries against NetSuite",
      capabilities: [
        "Arbitrary SQL query execution",
        "Pagination support",
        "State management for resumable queries",
        "Concurrent multi-query execution",
      ],
      supportedSyncModes: ["full_refresh"],
    };
  }

  /**
   * Yields records for a single query. Wraps {@link readRecords}, capturing its
   * generator return value (the {@link ExtractionSummary}) via manual iteration
   * since `for await...of` discards a generator's return value.
   *
   * When `options.recordType` or `options.schema` is set, a schema is resolved once
   * before the first record is yielded, and every row's `data` is coerced accordingly.
   * With neither, rows are yielded exactly as NetSuite returns them.
   */
  async *read(query: string, state?: StreamState, options?: ReadOptions): AsyncGenerator<SuiteQLRecord> {
    if (!query) {
      return;
    }

    if (options?.recordType && options.schema) {
      throw new SuiteQLError("ReadOptions.recordType and ReadOptions.schema are mutually exclusive.");
    }

    const schema = options?.schema ?? (options?.recordType ? await this.getSchemaDiscovery().getRecordSchema(options.recordType) : null);
    const fieldTypes = schema ? buildFieldTypeMap(schema, options?.coerceOverrides) : null;
    const schemaLabel = schema?.recordType.id ?? options?.recordType;

    const generator = readRecords(this.client, this.config, query, state);
    let step = await generator.next();
    let reportedCoverage = false;

    while (!step.done) {
      let data = step.value;

      if (fieldTypes) {
        if (!reportedCoverage) {
          reportedCoverage = true;
          const unmapped = getUnmappedColumns(data, fieldTypes);
          const total = Object.keys(data).length;
          options?.onCoercionWarning?.(
            `Coerced ${total - unmapped.length} of ${total} result columns using schema for '${schemaLabel}'` +
              (unmapped.length > 0 ? `; ${unmapped.length} unmapped: [${unmapped.join(", ")}]` : ""),
            { recordType: schemaLabel, mapped: total - unmapped.length, total, unmapped },
          );
        }
        data = coerceRow(data, fieldTypes, { onCoercionWarning: options?.onCoercionWarning });
      }

      yield { stream: "suiteql", data, emittedAt: Date.now() };
      step = await generator.next();
    }
  }

  private getSchemaDiscovery(): SchemaDiscovery {
    this.schemaDiscovery ??= new SchemaDiscovery(this.config);
    return this.schemaDiscovery;
  }

  /**
   * Runs each query through its own {@link read} call, bounded by
   * `maxConcurrentQueries`, yielding records in COMPLETION order rather than input order.
   *
   * One query failing does not abort its siblings, but the failure is never silently
   * dropped: every successfully-fetched record is yielded first, and if any query in
   * the batch failed, a {@link SuiteQLBatchError} listing all of them is thrown at the end.
   */
  async *readQueries(queries: string[], state?: StreamState): AsyncGenerator<SuiteQLRecord> {
    if (queries.length === 0) {
      return;
    }

    const semaphore = new Semaphore(this.config.maxConcurrentQueries);
    const pending = new Map<number, Promise<{ index: number; records: SuiteQLRecord[] }>>();
    const failures: BatchQueryFailure[] = [];

    queries.forEach((query, index) => {
      pending.set(
        index,
        semaphore.run(async () => {
          const records: SuiteQLRecord[] = [];
          try {
            for await (const record of this.read(query, state)) {
              records.push(record);
            }
          } catch (error) {
            failures.push({ query, error: error instanceof Error ? error.message : String(error) });
          }
          return { index, records };
        }),
      );
    });

    while (pending.size > 0) {
      const { index, records } = await Promise.race(pending.values());
      pending.delete(index);
      for (const record of records) {
        yield record;
      }
    }

    if (failures.length > 0) {
      throw new SuiteQLBatchError(failures);
    }
  }
}

export type { ExtractionSummary };
