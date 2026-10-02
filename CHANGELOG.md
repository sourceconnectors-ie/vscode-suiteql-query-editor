# Change Log

All notable changes to the "suiteql-query-editor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Add an optional per-connection server URL override (mock/proxy): an "Advanced" field in the Add
  Connection dialog and a "SuiteQL: Set Server URL (mock/proxy)…" command. Connections using it are
  marked `mock` in the status bar and connection list.
- Update the client library to 0.4.0, which tags its attribution banner and QR code for referral tracking.
- Tag the "Powered by" link and the post-connect link with UTM parameters, so visits driven by the
  extension can be identified in web analytics.

## [0.1.4] - 2026-09-28

- Add an MIT license, matching the repository now being open source.

## [0.1.3] - 2026-09-28

- Improve the Marketplace listing: clearer display name and description, searchable
  keywords, more accurate categories, and a restructured README with screenshots and a
  getting-started guide.

## [0.1.2] - 2026-09-27

- Add a Credits section linking to `@monty-nabil/netsuite-api-client-ts` on
  npm, the library this extension is built on.

## [0.1.1] - 2026-09-27

- Set an explicit `homepage` (the company website) so the Marketplace listing's
  Homepage link no longer defaults to the private source repository, which
  non-collaborators can't open. The Repository link itself is left as-is —
  pointing at a private repo is expected for a closed-source extension.
- Clarify in the README that the NetSuite client library is bundled into the
  extension — there's nothing to separately install to run queries.
- Set `bugs.email` so the Marketplace listing's Issues link reaches an actual
  inbox instead of defaulting to the private repository's issue tracker,
  which non-collaborators can't open (GitHub repo visibility is all-or-nothing —
  there's no way to expose just Issues on an otherwise-private repo).

## [0.1.0] - 2026-09-27

- Add OAuth 2.0 Client Credentials (M2M) as a second authentication method alongside
  OAuth 1.0a TBA. Adding a connection now asks which method to use; connections saved
  before M2M support keep working unchanged, treated as TBA.
- Add schema-aware syntax highlighting, drag-and-drop identifier insertion from the
  object explorer, and typed JSON export (columns coerced back to their real types
  using the downloaded schema instead of left as quoted strings).
- Add a per-connection RESTlet URL setting backing schema discovery; without one,
  schema discovery is disabled but the editor and query execution still work.
- Initial version: connection management (multiple labeled connections, single active
  connection), schema browser with an additive record-type picker, a query editor with
  a results pane (100-row default cap, "Fetch all" toggle, CSV/JSON export), and
  autocompletion for keywords/record types/columns.
- Results pane: "Clear" button; the grid renders at most 5,000 rows (exports keep every
  row); "Fetch all" stays in sync when the panel is hidden and shown again; the panel opens
  on the first run; a fetch-all stopped by the paging-offset limit says so.
- Run Query sends the statement under the cursor (trailing `;` stripped) instead of the
  whole file; tables/columns get an "Insert into Editor" context-menu entry.
- Fixes: connection dialog Cancel now stops a pending save; New Query no longer
  overwrites an existing file; re-running "Add Tables to Schema" no longer drops tables
  missing from the current RESTlet index; JSON export only applies the schema of the
  connection the query ran on; CSV export neutralizes spreadsheet formulas.
