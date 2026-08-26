# SuiteQL Query Editor

Connect to NetSuite accounts and run SuiteQL queries, browse the record schema, and get
autocompletion, directly from VS Code.

## Features

- **Multiple labeled connections** (e.g. "Production", "Sandbox1"), authenticated via
  OAuth 1.0a Token-Based Authentication. Only one connection is active at a time —
  switching connections disconnects the previous one.
- **Schema browser**: a left-panel tree under the SuiteQL activity bar icon showing the
  active connection, its downloaded record types, and each record type's fields.
  Schema is downloaded explicitly (never lazily on tree expand) via a checkbox picker
  that pre-selects commonly-used record types; re-running the picker lets you add more
  record types later without disturbing what's already there.
- **Query editor**: open a new SuiteQL query with the "SuiteQL: New Query" command, then
  run it with the "SuiteQL: Run Query" command (or its keybinding) against the active
  connection.
- **Results pane**: a docked panel showing query results as they come in. Every run
  defaults to a 100-row cap; check "Fetch all rows" to paginate through the full result
  set instead. Results can be exported to CSV or JSON.
- **Autocompletion** for SQL keywords, record type names (after `FROM`/`JOIN`), and
  column names (after `alias.`), sourced from the downloaded schema.

## Requirements

A NetSuite account with a configured integration record and access token (TBA) —
you'll need the account ID/realm, consumer key/secret, and token ID/secret to add a
connection.

## Extension Settings

- `suiteql.connections`: saved connection profiles (label, realm, consumer key, token
  ID). Secrets are never stored here — they live in VS Code's secret storage.

## Known Issues

- The completion provider uses simple heuristics rather than a full SQL parser — it can
  be wrong on complex/nested queries.
- The results grid renders all fetched rows without virtualization; very large "Fetch
  all" results may be slow to render.

## Release Notes

### 0.0.1

Initial version: connection management, schema browser, query editor with a results
pane, and autocompletion.
