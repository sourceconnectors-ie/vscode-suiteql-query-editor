import type { RestletClient } from "@monty-nabil/netsuite-api-client-ts";
import { logWarning } from "../outputChannel.js";
import { appendQuery, mapRcFieldToColumnInfo } from "./restletFieldMapping.js";
import type { SuiteQLColumnInfo, SuiteQLTableInfo } from "./schemaCacheTypes.js";

/**
 * Mirrors the wire contract `netsuite-schema-publisher`'s `schemaReader.restlet.ts` actually
 * returns (see that project's `src/shared/types.ts`) — there's no shared package between the
 * two repos, so this is a minimal local redeclaration. Keep it in sync if that contract changes.
 */
interface RcRecordTypeDetail {
  fields?: unknown[];
  [key: string]: unknown;
}

interface GatherErrorEntry {
  tableName: string;
  error: string;
}

interface SchemaIndex {
  tableNames: string[];
  errors: GatherErrorEntry[];
  gatheredAt: string;
  cancelled: boolean;
}

interface GatheredTable {
  tableName: string;
  detail: RcRecordTypeDetail;
  gatheredAt: string;
}

type RestletEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

type SchemaIndexResponse = RestletEnvelope<SchemaIndex>;
type SchemaTableResponse = RestletEnvelope<GatheredTable>;

/**
 * Describes a response that isn't the `{ok, data}` / `{ok, error}` envelope.
 *
 * Reading `response.error` off an arbitrary body reports "undefined" whenever the RESTlet
 * answered with something else entirely — a NetSuite-side error page, a permissions
 * complaint, a bare payload from a different script — which names a field that was never
 * there and throws away the only evidence of what actually came back. NetSuite answers
 * plenty of failures with HTTP 200 and a body of its own shape, so this is the common
 * case, not an edge one.
 */
function describeUnexpectedResponse(response: unknown): string {
  if (response && typeof response === "object") {
    const error = (response as { error?: unknown }).error;
    if (typeof error === "string" && error) {
      return error;
    }
    // NetSuite's own error bodies nest {code, message} under `error`.
    if (error && typeof error === "object") {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (typeof message === "string" && message) {
        return typeof code === "string" ? `${code}: ${message}` : message;
      }
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    serialized = String(response);
  }
  if (serialized === undefined || serialized === "undefined") {
    serialized = String(response);
  }
  const clipped = serialized.length > 500 ? `${serialized.slice(0, 500)}…` : serialized;
  return `unexpected response shape — ${clipped}`;
}

/**
 * Discovers the catalog of SuiteQL-queryable tables/columns for the object explorer and
 * completion provider, entirely via a per-connection RESTlet (see `ConnectionProfile.restletUrl`)
 * implementing `netsuite-schema-publisher`'s `mode=index`/`mode=table` contract. Replaces the
 * REST Record Metadata Catalog + SuiteQL-introspection approach this extension used previously:
 * the RESTlet's catalog is gathered from NetSuite's internal Records Catalog backend, which
 * already covers SuiteQL-only generic tables (`transaction`/`transactionline`/...) that neither
 * of those could reach on their own, so there's no longer a need to union in a curated list or
 * fall back to sampling query results.
 */
export class RestletSchemaDiscovery {
  /**
   * Takes the connection's shared `RestletClient` rather than building one from a config:
   * under M2M the access token is cached per client instance, so a per-download client
   * would pay for a fresh token exchange every time. The caller owns its lifetime.
   */
  constructor(
    private readonly client: RestletClient,
    private readonly restletUrl: string,
  ) {}

  async getAllTables(signal?: AbortSignal): Promise<SuiteQLTableInfo[]> {
    const response = await this.client.call<SchemaIndexResponse>(appendQuery(this.restletUrl, { mode: "index" }), {
      signal,
    });
    if (!response.ok) {
      throw new Error(`RESTlet schema index request failed: ${describeUnexpectedResponse(response)}`);
    }
    if (!response.data || !Array.isArray(response.data.tableNames)) {
      throw new Error(
        `RESTlet schema index returned no table list: ${describeUnexpectedResponse(response)}`,
      );
    }
    if (Array.isArray(response.data.errors) && response.data.errors.length > 0) {
      logWarning(
        `RESTlet schema index reports ${response.data.errors.length} table(s) that failed to gather on the last publish run: ${response.data.errors.map((entry) => entry.tableName).join(", ")}`,
      );
    }
    return response.data.tableNames.map((tableName) => ({ tableName }));
  }

  async getColumnsForTable(
    tableName: string,
    signal?: AbortSignal,
  ): Promise<{ columns: SuiteQLColumnInfo[]; source: "restlet" }> {
    const response = await this.client.call<SchemaTableResponse>(
      appendQuery(this.restletUrl, { mode: "table", table: tableName }),
      { signal },
    );
    if (!response.ok) {
      throw new Error(
        `RESTlet schema request for "${tableName}" failed: ${describeUnexpectedResponse(response)}`,
      );
    }
    const fields = Array.isArray(response.data.detail.fields) ? response.data.detail.fields : [];
    const columns = fields.map(mapRcFieldToColumnInfo).filter((column): column is SuiteQLColumnInfo => column !== undefined);
    return { columns, source: "restlet" };
  }
}
