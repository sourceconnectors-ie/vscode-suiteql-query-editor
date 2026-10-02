# NetSuite SuiteQL Query Editor

Run NetSuite SuiteQL queries in VS Code — browse your schema, get autocompletion and
semantic highlighting, and export results to CSV or JSON, without leaving the editor.

![SuiteQL query editor with schema-aware syntax highlighting](https://raw.githubusercontent.com/sourceconnectors-ie/suiteql-query-editor-assets/c4660d217231871f58763156a6a1b4eaa0eefc58/query-editor-highlighting.png)

## Query execution

Run SuiteQL directly against a connected NetSuite account from a `.suiteql` file.
Results stream into a docked results pane with pagination and mid-flight cancellation,
so you're never stuck waiting on a query you didn't mean to run in full.

## Schema-aware editing

An object explorer shows your NetSuite tables and columns, autocompletion suggests real
schema identifiers as you type, and matching identifiers get semantic highlighting in
the editor. This tier needs an additional RESTlet component that isn't publicly
self-service yet — see [Requirements](#requirements) below, or contact
**hello@sourceconnectors.ie**.

## Results export

Export query results to CSV or JSON — JSON export coerces columns back to their real
types instead of leaving everything as quoted strings.

## Getting Started

1. Install the extension from the VS Code Marketplace.
2. Configure credentials — OAuth 1.0a (TBA) or OAuth 2.0 Client Credentials (M2M); see
   [Requirements](#requirements) below for exact setup steps.
3. Run **"SuiteQL: Add Connection"** and add your account.
4. Run **"SuiteQL: New Query"** to create a `.suiteql` file.
5. Run it with **"SuiteQL: Run Query"** (`Cmd+Shift+E` / `Ctrl+Shift+E`).

## Features

### Multiple connections

Save multiple labeled connections (e.g. "Production", "Sandbox1"), authenticated with
either **OAuth 1.0a Token-Based Authentication (TBA)** or **OAuth 2.0 Client Credentials
(M2M)**. Adding a connection asks which method to use, then collects only that method's
credentials. Only one connection is active at a time — switching connections disconnects
the previous one. The active connection is shown in the status bar; click it to switch or
add another.

Connections saved before OAuth 2.0 support keep working unchanged; they're treated as TBA.

### Schema browser

A left-panel tree under the SuiteQL activity bar icon, showing every saved connection
(connected or not), the active connection's downloaded tables, and each table's columns
— sourced live from a per-connection RESTlet (see [Requirements](#requirements) below).

![Object explorer tree showing NetSuite tables and columns](https://raw.githubusercontent.com/sourceconnectors-ie/suiteql-query-editor-assets/c4660d217231871f58763156a6a1b4eaa0eefc58/object-explorer.png)

Schema is downloaded explicitly, never lazily on tree expand: run **"SuiteQL: Add
Tables to Schema"** to open a checkbox picker (pre-selecting commonly-queried tables),
select what you want, and it downloads just those tables' columns. Re-running the
picker later lets you add more tables without disturbing what's already downloaded.

Use **"SuiteQL: Filter Schema"** to narrow the tree to tables/columns matching a search
term — a table matching by its own name shows all its columns; one matching only
because a column inside it matches shows just that column.

### Query editor with schema-aware highlighting

Open a new SuiteQL query with **"SuiteQL: New Query"**, then run it with **"SuiteQL:
Run Query"** (or `Cmd+Shift+E` / `Ctrl+Shift+E`) against the active connection. A file can
hold several `;`-separated queries: Run Query sends the one under the cursor (or exactly
the selected one), without the trailing `;`.
`.suiteql` files get full SQL syntax highlighting, plus semantic highlighting on top:
identifiers that match a table or column in your *actual downloaded schema* are colored
distinctly (tables vs. columns) — something a generic SQL grammar can't do, since it has
no way to know which identifiers are real NetSuite schema names versus arbitrary syntax.

### Autocompletion

Completion for SQL keywords, table names (after `FROM`/`JOIN`), and column names (after
`alias.`), sourced entirely from the downloaded schema.

![Autocompletion suggesting table and column names](https://raw.githubusercontent.com/sourceconnectors-ie/suiteql-query-editor-assets/c4660d217231871f58763156a6a1b4eaa0eefc58/autocompletion.png)

### Drag tables/columns into a query

Drag a table or column from the object explorer and drop it into a SuiteQL editor to
insert its name at the drop position, or right-click it and choose **"Insert into
Editor"** to insert it at the cursor.

### Results pane

A docked panel showing query results as they come in. Every run defaults to a 100-row
cap; check "Fetch all rows" to paginate through the full result set instead. The grid
shows at most the first 5,000 rows of a result set (export always writes every row), and
**Clear** removes the results shown for the current file.

![Results pane showing query output](https://raw.githubusercontent.com/sourceconnectors-ie/suiteql-query-editor-assets/c4660d217231871f58763156a6a1b4eaa0eefc58/results-pane.png)

A running query (including a "Fetch all" pagination loop) can be cancelled mid-flight
from its progress notification — the request in flight is aborted immediately rather
than being left to run out its retry budget.

### Export results

Export the current results to CSV or JSON. JSON export coerces columns back to their
real types (numbers, booleans) using the downloaded schema, instead of leaving every
value as a quoted string the way NetSuite's REST endpoint returns them.

![Exporting query results to CSV or JSON](https://raw.githubusercontent.com/sourceconnectors-ie/suiteql-query-editor-assets/c4660d217231871f58763156a6a1b4eaa0eefc58/export-results.png)

## Requirements

Nothing to install beyond this extension — its NetSuite client library is bundled in, not
a separate download.

A NetSuite account with a configured integration record, plus credentials for whichever
authentication method you choose. Either one is enough to run queries and use the query
editor.

**OAuth 1.0a (TBA)** — the account ID/realm, consumer key/secret, and token ID/secret.
Note that NetSuite blocks *new* TBA integrations from release 2027.1, with tentative full
end-of-support at 2028.1, so prefer OAuth 2.0 for a new setup.

**OAuth 2.0 Client Credentials (M2M)** — the account ID/realm, client ID, certificate ID,
and the certificate's private key. To set one up in NetSuite:

1. Enable the OAuth 2.0 feature (Setup → Company → Enable Features → SuiteCloud).
2. Create an integration record with the **Client Credentials (M2M) Grant** flow, and
   grant it **both** the `rest_webservices` and `restlets` scopes. With only the first,
   queries work while schema discovery fails with a 401 — a confusing way to find out.
3. Generate a key pair. NetSuite accepts RSA at **3072 or 4096 bits only**, or EC at
   256/384/521.
4. Register the certificate against **that same** integration record — a certificate
   registered elsewhere returns `unauthorized_client`.
5. Grant the associated role the permissions your queries need.

Paste the private key into the dialog or pick the `.pem` file; either way only its
contents are stored, in VS Code's secret storage, never the file path. Sign with PS256
for an RSA certificate or an ES variant for EC — RS256 isn't offered, because NetSuite
rejects it.

**Schema discovery** (the object explorer tree, autocompletion, semantic highlighting)
additionally requires a per-connection RESTlet URL, set via **"SuiteQL: Set RESTlet
URL…"**. Without one, schema discovery is disabled (the object explorer shows a
"RESTlet not configured" prompt) but the editor and query execution still work — you can
still type and run queries by hand. The RESTlet itself is a companion server-side
project (`netsuite-schema-publisher`), deployed into your NetSuite account. This project
isn't publicly available yet — contact **hello@sourceconnectors.ie** to arrange setup.

## Commands

| Command | What it does |
|---|---|
| SuiteQL: Add Connection | Opens the Add Connection form |
| SuiteQL: Select Connection | Switch the active connection, or add a new one |
| SuiteQL: Remove Connection | Delete a saved connection and its stored secrets |
| SuiteQL: Set RESTlet URL… | Set/clear the RESTlet URL backing schema discovery for a connection |
| SuiteQL: Set Server URL (mock/proxy)… | Set/clear a server URL used instead of the account's NetSuite host |
| SuiteQL: Add Tables to Schema | Open the table picker and download selected tables' columns |
| SuiteQL: Clear Schema Cache | Discard a connection's downloaded schema |
| SuiteQL: Filter Schema / Clear Schema Filter | Search/reset the object explorer tree |
| SuiteQL: New Query | Open a new `.suiteql` file |
| SuiteQL: Run Query | Run the current file (or selection) against the active connection |

## Extension Settings

- `suiteql.connections`: saved connection profiles — label, realm, RESTlet URL, and the
  non-secret half of the credentials (consumer key and token ID for TBA; client ID,
  certificate ID and JWT algorithm for OAuth 2.0). Secrets — consumer secret, token
  secret, private key — are never stored here; they live in VS Code's secret storage.

## Testing against a mock server

To run queries against a mock or proxy instead of a real account, give a connection a **server URL**:
fill in *Advanced: server URL override* when adding it, or run **SuiteQL: Set Server URL (mock/proxy)…**
on an existing one (blank clears it). The URL must be a complete `http://` or `https://` address with
no query string, fragment or credentials, e.g. `http://127.0.0.1:8000`. Both OAuth 1.0a and OAuth 2.0
(M2M) connections honour it, and the connection is marked `mock` in the status bar and connection list.
Use any realm and credentials the mock accepts. Schema discovery needs a RESTlet, which a mock normally
doesn't have, so leave the RESTlet URL blank.

## Known Issues

- The completion provider, semantic highlighting, and results-column detection all use
  simple heuristics rather than a full SQL parser — they can be wrong on complex/nested
  queries.
- The results grid renders all fetched rows without virtualization; very large "Fetch
  all" results may be slow to render.
- Dragging a table/column into the editor requires the (default-on)
  `editor.dropIntoEditor.enabled` setting.
- The **SuiteQL** output channel shows an attribution banner, with a QR code, from the
  underlying `netsuite-api-client-ts` library. It appears once per connection (switching
  or reconnecting shows it again) and is expected — not a sign that anything went wrong.
  The object explorer also carries a permanent attribution entry at the bottom of the
  tree, for the same reason.

## Credits

Built on [`@monty-nabil/netsuite-api-client-ts`](https://www.npmjs.com/package/@monty-nabil/netsuite-api-client-ts),
a NetSuite REST/SuiteQL/RESTlet client published separately for other Node.js and
TypeScript projects to use directly.

## Release Notes

### 0.1.0

Adds OAuth 2.0 Client Credentials (M2M) as a second authentication method alongside
OAuth 1.0a TBA — connections saved before M2M support keep working unchanged. Everything
from the initial version: connection management, a RESTlet-backed schema browser, a
query editor with schema-aware syntax/semantic highlighting and autocompletion,
drag-and-drop identifier insertion, a results pane with cancellable/paginated execution,
and CSV/typed-JSON export.
