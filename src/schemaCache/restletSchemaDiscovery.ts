import { RestletClient, type SuiteQLConfig } from "@monty-nabil/netsuite-api-client-ts";
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
  private readonly client: RestletClient;

  constructor(config: SuiteQLConfig, private readonly restletUrl: string) {
    this.client = new RestletClient(config);
  }

  async getAllTables(signal?: AbortSignal): Promise<SuiteQLTableInfo[]> {
    const response = await this.client.call<SchemaIndexResponse>(appendQuery(this.restletUrl, { mode: "index" }), {
      signal,
    });
    if (!response.ok) {
      throw new Error(`RESTlet schema index request failed: ${response.error}`);
    }
    if (response.data.errors.length > 0) {
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
      throw new Error(`RESTlet schema request for "${tableName}" failed: ${response.error}`);
    }
    const fields = Array.isArray(response.data.detail.fields) ? response.data.detail.fields : [];
    const columns = fields.map(mapRcFieldToColumnInfo).filter((column): column is SuiteQLColumnInfo => column !== undefined);
    return { columns, source: "restlet" };
  }
}
