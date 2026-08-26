import { getMetadataCatalogUrl, type SuiteQLConfig } from "./config.js";
import { SchemaDiscoveryError } from "./errors.js";
import { createOAuthClient, getAuthorizationHeader } from "./oauth1.js";

export interface RecordTypeInfo {
  id: string;
  label: string;
  isCustom: boolean;
  supportsSuiteQL: boolean;
  hasSublists: boolean;
}

export interface FieldSchema {
  name: string;
  label: string;
  /** Raw JSON-Schema type: "string" | "integer" | "number" | "boolean" | "object" | "array". */
  dataType: string;
  isRequired: boolean;
  isCustom: boolean;
  maxLength?: number;
  description?: string;
}

export interface RelationshipSchema {
  fieldName: string;
  targetRecordType: string;
  relationshipType: "many-to-one" | "one-to-many";
  label: string;
}

export interface RecordSchema {
  recordType: RecordTypeInfo;
  fields: FieldSchema[];
  relationships: RelationshipSchema[];
}

/** Field-name prefixes NetSuite uses for custom fields. */
const CUSTOM_FIELD_PREFIXES = ["custbody", "custentity", "custcol", "custrecord", "custitem"];

function isCustomField(fieldName: string): boolean {
  return CUSTOM_FIELD_PREFIXES.some((prefix) => fieldName.startsWith(prefix));
}

function isCustomRecord(recordId: string): boolean {
  return recordId.startsWith("customrecord_");
}

function unwrapNullableType(type: unknown): string {
  if (Array.isArray(type)) {
    return (type.find((t) => t !== "null") as string | undefined) ?? "string";
  }
  return typeof type === "string" ? type : "string";
}

interface JsonSchemaFieldDef {
  type?: unknown;
  title?: string;
  maxLength?: number;
  description?: string;
  properties?: Record<string, unknown>;
}

/**
 * Fetches NetSuite record-type field metadata from the REST Metadata Catalog API.
 * Deliberately does not share transport code with {@link SuiteQLClient} — metadata
 * calls are 1-2 per run, and unlike query execution this class has NO retry logic
 * of its own; callers that need resilience (e.g. downloading many record types)
 * must add their own retry/backoff around `getRecordSchema`.
 */
export class SchemaDiscovery {
  private readonly config: SuiteQLConfig;
  private readonly baseUrl: string;
  private readonly cache = new Map<string, RecordSchema>();

  constructor(config: SuiteQLConfig) {
    this.config = config;
    this.baseUrl = getMetadataCatalogUrl(config);
  }

  private async request(url: string, accept: string): Promise<unknown> {
    const oauth = createOAuthClient(this.config);
    const authorization = getAuthorizationHeader(
      oauth,
      { key: this.config.tokenKey, secret: this.config.tokenSecret },
      url,
      "GET",
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: accept, Prefer: "transient", Authorization: authorization },
        signal: AbortSignal.timeout(this.config.queryTimeout * 1000),
      });
    } catch (cause) {
      throw new SchemaDiscoveryError(
        `Failed to reach metadata-catalog endpoint: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      throw new SchemaDiscoveryError(`HTTP ${response.status}: ${response.statusText}. ${rawBody}`);
    }

    return response.json();
  }

  async getAllRecordTypes(level?: string): Promise<RecordTypeInfo[]> {
    const url = level ? `${this.baseUrl}?level=${encodeURIComponent(level)}` : this.baseUrl;
    const data = (await this.request(url, "application/json")) as Record<string, unknown>;

    if ("o:errorDetails" in data || ("type" in data && "status" in data)) {
      throw new SchemaDiscoveryError(
        `API error: ${(data.title as string) ?? "Unknown error"}. Details: ${JSON.stringify(data["o:errorDetails"] ?? [])}`,
      );
    }

    const items = (data.items as Array<Record<string, unknown>> | undefined) ?? [];
    return items.map((item) => {
      const id = (item.id as string) || (item.name as string) || (item.type as string) || "";
      const label =
        (item.label as string) || (item.displayName as string) || (item.title as string) || id;
      return {
        id,
        label,
        isCustom: isCustomRecord(id),
        supportsSuiteQL: (item.supportsSuiteQL as boolean | undefined) ?? true,
        hasSublists: (item.hasSublists as boolean | undefined) ?? false,
      };
    });
  }

  async getRecordSchema(recordType: string): Promise<RecordSchema> {
    const cached = this.cache.get(recordType);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl}/${recordType}`;
    const schemaData = (await this.request(url, "application/schema+json")) as Record<string, unknown>;

    const hasProperties = "properties" in schemaData;
    if ("o:errorDetails" in schemaData || ("type" in schemaData && "status" in schemaData && !hasProperties)) {
      throw new SchemaDiscoveryError(
        `API error for record type '${recordType}': ${(schemaData.title as string) ?? "Unknown error"}. Details: ${JSON.stringify(schemaData["o:errorDetails"] ?? [])}`,
      );
    }

    const recordInfo: RecordTypeInfo = {
      id: recordType,
      label: (schemaData.title as string) ?? recordType,
      isCustom: isCustomRecord(recordType),
      supportsSuiteQL: true,
      hasSublists: false,
    };

    const fields: FieldSchema[] = [];
    const relationships: RelationshipSchema[] = [];
    const properties = (schemaData.properties as Record<string, JsonSchemaFieldDef> | undefined) ?? {};
    const requiredFields = (schemaData.required as string[] | undefined) ?? [];

    for (const [fieldName, fieldDef] of Object.entries(properties)) {
      const dataType = unwrapNullableType(fieldDef.type);
      const nestedProps = fieldDef.properties ?? {};
      const isReferenceObject = dataType === "object" && "refName" in nestedProps && "id" in nestedProps;
      const isSublist = dataType === "object" && "items" in nestedProps && "totalResults" in nestedProps;

      if (isReferenceObject) {
        relationships.push({
          fieldName,
          targetRecordType: fieldName,
          relationshipType: "many-to-one",
          label: fieldDef.title ?? fieldName,
        });
      } else if (isSublist) {
        relationships.push({
          fieldName,
          targetRecordType: fieldName,
          relationshipType: "one-to-many",
          label: fieldDef.title ?? fieldName,
        });
      }

      fields.push({
        name: fieldName,
        label: fieldDef.title ?? fieldName,
        dataType,
        isRequired: requiredFields.includes(fieldName),
        isCustom: isCustomField(fieldName),
        maxLength: fieldDef.maxLength,
        description: fieldDef.description,
      });
    }

    const schema: RecordSchema = { recordType: recordInfo, fields, relationships };
    this.cache.set(recordType, schema);
    return schema;
  }
}
