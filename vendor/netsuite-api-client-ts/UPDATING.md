# Vendored copy of netsuite-api-client-ts

This directory is a manually-vendored subset of the `netsuite-api-client-ts` library's
`src/` sources, copied in verbatim (not installed via npm — that library isn't published,
and it's ESM-only, so this extension bundles its TypeScript sources directly with esbuild
instead of depending on a `file:`/git package).

## What's vendored and why

Vendored: `config.ts`, `constants.ts`, `errors.ts`, `oauth1.ts`, `client.ts`,
`restlet-client.ts`, `schema-discovery.ts`, `connector.ts`, `stream.ts`, `retry.ts`,
`semaphore.ts`, `coerce.ts`, `sql.ts`, plus this hand-written `index.ts` barrel.

Note: `restlet-client.ts` (`RestletClient`) is a generic, sign-and-call-any-RESTlet-URL
primitive — not tied to any particular RESTlet's contract. This extension's schema
discovery (`src/schemaCache/restletSchemaDiscovery.ts`) is its main consumer: it calls a
per-connection RESTlet URL (see `ConnectionProfile.restletUrl`) that implements the
`mode=index`/`mode=table` contract from the separate `netsuite-schema-publisher` project,
which is the only current source of schema data. The RESTlet's catalog (gathered from
NetSuite's internal Records Catalog backend) covers the SuiteQL-only generic tables
(`transaction`/`transactionline`/...) that neither the REST Record Metadata Catalog nor
SuiteQL introspection could reach on their own, which is why this extension moved to it
as the sole schema source instead of keeping those as a fallback.

`schema-discovery.ts` (`SchemaDiscovery`, REST Record Metadata Catalog client) stays
vendored even though nothing calls it directly for schema discovery anymore —
`connector.ts`'s `SuiteQLConnector.discover()` and `coerce.ts`'s row-type coercion (both
still used for actual query execution) depend on its `RecordSchema` type/class
transitively, so it can't be dropped.

Deliberately NOT vendored:
- `schema-file.ts` — one-file-per-record-type YAML/JSON serializer with sync `fs` calls;
  the wrong shape for caching hundreds of record types. This extension rolls its own
  single-JSON-per-connection schema cache instead (see `src/schemaCache/`).
- `json-path.ts` — only used by the library's CLI.
- everything under the library's `src/cli/` — CLI-only, not relevant to an extension host.

Runtime dependencies this vendored code needs: `oauth-1.0a`, `zod` (declared in this
project's own `package.json`).

## Local modifications (not upstream — reapply on re-vendor)

`errors.ts`, `retry.ts`, `restlet-client.ts`, and `client.ts` diverge from upstream:
cancellation support was added on top of upstream's retry loops, since this extension
needs a caller to be able to stop a stuck retry cycle (a full `Add Tables to Schema` /
query run + retries can otherwise run for tens of minutes against a server that's timing
out or 503ing).

- `errors.ts`: new `OperationCancelledError` — thrown when a caller-supplied
  `AbortSignal` fires; never retried, and distinct from a request timeout or
  network-level abort (both of which stay retryable). `SuiteQLHttpError` also gained a
  `rawBody: string | undefined` field (the response body it was already given, just not
  previously kept) — surfaced by `src/outputChannel.ts`'s `logError`, since
  `extractNetSuiteMessage`'s fallback message ("HTTP 403: Forbidden", etc.) can otherwise
  hide the only diagnostic detail NetSuite actually returned (e.g. an HTML permission page
  for a 403 that isn't in NetSuite's usual JSON error shape).
- `retry.ts`: `sleep()` takes an optional `signal?: AbortSignal` and rejects with
  `OperationCancelledError` as soon as it aborts, instead of always waiting out the full
  backoff delay.
- `restlet-client.ts` (`RestletClient.call`) / `client.ts` (`SuiteQLClient.executeQuery`):
  both take an optional trailing `signal?: AbortSignal`, checked before each attempt and
  passed into `sleep()` during backoff. The request's own `fetch` merges it with the
  existing timeout signal via `AbortSignal.any(...)` — the merged signal doesn't say
  *which* member fired, so the abort handler re-checks the caller's own `signal`
  specifically (a timeout abort must stay retryable; a caller-cancelled one must not).
  `OperationCancelledError` short-circuits the retry loop unconditionally, on first
  attempt or mid-backoff.

Both additions are trailing-optional-parameter changes, so callers that don't pass a
signal are unaffected — keep it that way on re-vendor so the diff against upstream stays
small: reapply these four changes on top of whatever upstream now looks like, rather than
discarding them.

- `client.ts` also strips the `links` field the SuiteQL REST endpoint adds to every result
  row (HATEOAS navigation metadata, not one of the query's SELECTed columns) inside
  `executeRequest`, via a `stripLinksField` helper — so it's gone before any consumer
  (`SuiteQLClient.executeQuery`, `readRecords`/`SuiteQLConnector` built on top of it, and
  ultimately this extension's results grid and CSV/JSON export) ever sees it, rather than
  each of those needing to filter it back out or presenting it as a spurious extra column.

## Re-vendoring

There's no automated sync. To pick up upstream changes:
1. Diff each vendored file against the current version of the source library.
2. Re-apply the same list of files above (do not vendor `schema-file.ts`/`json-path.ts`/`cli/`
   unless the exclusion reasons above no longer apply).
3. Update `index.ts`'s barrel exports to match any new/removed public exports.
4. Re-run the esbuild smoke test before relying on the update.
