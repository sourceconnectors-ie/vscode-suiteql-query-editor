# Vendored copy of netsuite-api-client-ts

This directory is a manually-vendored subset of the `netsuite-api-client-ts` library's
`src/` sources, copied in verbatim (not installed via npm — that library isn't published,
and it's ESM-only, so this extension bundles its TypeScript sources directly with esbuild
instead of depending on a `file:`/git package).

## What's vendored and why

Vendored: `config.ts`, `constants.ts`, `errors.ts`, `oauth1.ts`, `client.ts`,
`schema-discovery.ts`, `connector.ts`, `stream.ts`, `retry.ts`, `semaphore.ts`,
`coerce.ts`, `sql.ts`, plus this hand-written `index.ts` barrel.

Deliberately NOT vendored:
- `schema-file.ts` — one-file-per-record-type YAML/JSON serializer with sync `fs` calls;
  the wrong shape for caching hundreds of record types. This extension rolls its own
  single-JSON-per-connection schema cache instead (see `src/schemaCache/`).
- `json-path.ts` — only used by the library's CLI.
- everything under the library's `src/cli/` — CLI-only, not relevant to an extension host.

Runtime dependencies this vendored code needs: `oauth-1.0a`, `zod` (declared in this
project's own `package.json`).

## Re-vendoring

There's no automated sync. To pick up upstream changes:
1. Diff each vendored file against the current version of the source library.
2. Re-apply the same list of files above (do not vendor `schema-file.ts`/`json-path.ts`/`cli/`
   unless the exclusion reasons above no longer apply).
3. Update `index.ts`'s barrel exports to match any new/removed public exports.
4. Re-run the esbuild smoke test before relying on the update.
