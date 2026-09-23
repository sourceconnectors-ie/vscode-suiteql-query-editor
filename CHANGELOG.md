# Change Log

All notable changes to the "suiteql-query-editor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial version: connection management (multiple labeled connections, single active
  connection, OAuth 1.0a TBA), schema browser with an additive record-type picker, a
  query editor with a results pane (100-row default cap, "Fetch all" toggle, CSV/JSON
  export), and autocompletion for keywords/record types/columns.
- Results pane: "Clear" button; the grid renders at most 5,000 rows (exports keep every
  row); "Fetch all" stays in sync when the panel is hidden and shown again; the panel opens
  on the first run; a fetch-all stopped by the paging-offset limit says so.
- Run Query sends the statement under the cursor (trailing `;` stripped) instead of the
  whole file; tables/columns get an "Insert into Editor" context-menu entry.
- Fixes: connection dialog Cancel now stops a pending save; New Query no longer
  overwrites an existing file; re-running "Add Tables to Schema" no longer drops tables
  missing from the current RESTlet index; JSON export only applies the schema of the
  connection the query ran on; CSV export neutralizes spreadsheet formulas.
