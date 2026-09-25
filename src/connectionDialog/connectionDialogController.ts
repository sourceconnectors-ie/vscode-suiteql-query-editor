import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import { confirmDisconnectIfRunning } from "../connection/confirmDisconnect.js";
import { DEFAULT_JWT_ALGORITHM, JWT_ALGORITHMS, type AuthType, type ConnectionProfile } from "../connection/connectionProfile.js";
import type { ConnectionService } from "../connection/connectionService.js";
import { logError } from "../outputChannel.js";
import type { ResultsViewProvider } from "../resultsPane/resultsViewProvider.js";
import type { ConnectionDialogInboundMessage, ConnectionDialogOutboundMessage } from "./connectionDialogProtocol.js";

/** Invoked after a connection is saved and activated, so the caller can kick off schema download. */
export type OnConnected = (profile: ConnectionProfile) => Promise<void>;

let currentPanel: vscode.WebviewPanel | undefined;

export function openConnectionDialog(
  context: vscode.ExtensionContext,
  connectionService: ConnectionService,
  activeConnection: ActiveConnectionManager,
  resultsView: ResultsViewProvider,
  onConnected: OnConnected,
  authType: AuthType,
): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "suiteql.connectionDialog",
    "SuiteQL: Add Connection",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Keep the typed-in form alive while the user switches tabs to copy a token or
      // secret from elsewhere — without this, hiding the tab wipes everything entered.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );
  currentPanel = panel;

  // Closing the dialog (Cancel, or closing its tab) aborts an in-flight test and stops a
  // pending Save & Connect before it persists anything. `disposed` also stops posting to
  // a panel that no longer exists, which throws.
  let disposed = false;
  const abortController = new AbortController();
  const post = (message: ConnectionDialogOutboundMessage): void => {
    if (!disposed) {
      void panel.webview.postMessage(message);
    }
  };

  panel.webview.html = renderHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message: ConnectionDialogInboundMessage) => {
    switch (message.type) {
      case "ready":
        post({ type: "init", authType });
        return;

      case "testConnection": {
        post({ type: "testConnectionStarted" });
        const result = await connectionService.testConnection(message.profile, abortController.signal);
        post({
          type: "testConnectionResult",
          status: result.success ? "success" : "failed",
          message: result.message,
        });
        return;
      }

      case "saveAndConnect": {
        post({ type: "saveAndConnectStarted" });
        try {
          const testResult = await connectionService.testConnection(message.profile, abortController.signal);
          if (disposed) {
            return; // closed while testing — the user cancelled, so save nothing
          }
          if (!testResult.success) {
            post({ type: "saveAndConnectResult", status: "failed", message: testResult.message });
            return;
          }
          if ((await confirmDisconnectIfRunning(activeConnection, resultsView)) === "abort") {
            post({ type: "saveAndConnectResult", status: "failed", message: "Cancelled." });
            return;
          }
          if (disposed) {
            return;
          }
          // Cancellation stops here. Writing the profile and its two secrets isn't
          // cancellable (a half-written connection would be worse than a finished one), so
          // the dialog disables Cancel from this point, and closing the tab anyway still
          // finishes the save — reported below instead of happening silently.
          post({ type: "saveAndConnectCommitting" });
          const profile = await connectionService.addConnectionAndActivate(message.profile);
          if (disposed) {
            void vscode.window.showInformationMessage(
              `SuiteQL: the dialog was closed while saving — "${profile.label}" was saved and connected anyway.`,
            );
          }
          post({ type: "saveAndConnectResult", status: "success", label: profile.label });
          panel.dispose();
          await onConnected(profile);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError("Failed to save/activate connection", error);
          if (disposed) {
            void vscode.window.showErrorMessage(`SuiteQL: failed to save connection — ${errorMessage}`);
          }
          post({ type: "saveAndConnectResult", status: "failed", message: errorMessage });
        }
        return;
      }

      case "browseForPrivateKey": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Use this private key",
          title: "Select the OAuth 2.0 M2M private key",
          filters: { "Private key": ["pem", "key"], "All files": ["*"] },
        });
        if (disposed) {
          return;
        }
        if (!picked || picked.length === 0) {
          post({ type: "privateKeyFileRead", status: "cancelled" });
          return;
        }
        const [uri] = picked;
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          // Only the contents travel back: the key is headed for SecretStorage, and
          // remembering a path would leave the connection dependent on a file that can
          // move, change, or be deleted after the fact.
          post({
            type: "privateKeyFileRead",
            status: "success",
            contents: new TextDecoder().decode(bytes),
            fileName: uri.path.split("/").pop() ?? "private key",
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Deliberately not logged: a read failure can echo the path back, and the file
          // sits wherever the user keeps their keys.
          post({ type: "privateKeyFileRead", status: "failed", message: errorMessage });
        }
        return;
      }

      case "cancel":
        panel.dispose();
        return;
    }
  });

  panel.onDidDispose(() => {
    disposed = true;
    abortController.abort();
    currentPanel = undefined;
  });
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webviews", "connectionDialog.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webviews", "connectionDialog.css"),
  );
  const nonce = randomBytes(16).toString("base64");
  // Built from the shared constant so the dialog can't drift from the profile model, or
  // from the set the library's config schema actually accepts.
  const jwtAlgorithmOptions = JWT_ALGORITHMS.map(
    (algorithm) =>
      `<option value="${algorithm}"${algorithm === DEFAULT_JWT_ALGORITHM ? " selected" : ""}>${algorithm}</option>`,
  ).join("\n        ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>SuiteQL: Add Connection</title>
</head>
<body>
  <form id="connection-form">
    <h1>Add NetSuite Connection</h1>

    <fieldset class="auth-picker">
      <legend>Authentication</legend>
      <label class="radio"><input type="radio" name="authType" value="tba"> OAuth 1.0a (Token-Based Auth)</label>
      <label class="radio"><input type="radio" name="authType" value="m2m"> OAuth 2.0 (Client Credentials / M2M)</label>
    </fieldset>

    <label for="label">Label</label>
    <input id="label" type="text" placeholder="e.g. Production, Sandbox1" required autocomplete="off">

    <label for="realm">Account ID / realm</label>
    <input id="realm" type="text" placeholder="e.g. 1234567_SB1" required autocomplete="off">

    <fieldset id="tba-fields" class="auth-fields">
      <legend class="sr-only">OAuth 1.0a credentials</legend>

      <label for="consumerKey">Consumer key</label>
      <input id="consumerKey" type="text" required autocomplete="off">

      <label for="consumerSecret">Consumer secret</label>
      <input id="consumerSecret" type="password" required autocomplete="off">

      <label for="tokenKey">Token ID</label>
      <input id="tokenKey" type="text" required autocomplete="off">

      <label for="tokenSecret">Token secret</label>
      <input id="tokenSecret" type="password" required autocomplete="off">
    </fieldset>

    <fieldset id="m2m-fields" class="auth-fields">
      <legend class="sr-only">OAuth 2.0 credentials</legend>

      <label for="clientId">Client ID</label>
      <input id="clientId" type="text" required autocomplete="off">

      <label for="certificateId">Certificate ID</label>
      <input id="certificateId" type="text" required autocomplete="off">

      <label for="privateKey">Private key (PEM)</label>
      <textarea id="privateKey" rows="6" required autocomplete="off" spellcheck="false"
        placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----"></textarea>
      <div class="actions inline">
        <button type="button" id="browse-private-key" class="secondary">Browse…</button>
        <span id="private-key-note" class="hint inline-note"></span>
      </div>
      <p class="hint">Paste the PEM, or pick the file — either way only its contents are stored, in VS Code's secret storage.</p>

      <label for="jwtAlgorithm">JWT algorithm</label>
      <select id="jwtAlgorithm">
        ${jwtAlgorithmOptions}
      </select>
      <p class="hint">PS256 suits an RSA certificate, the ES options an EC one. RS256 isn’t offered — NetSuite rejects it.</p>

      <p class="hint">The integration record needs both the <code>rest_webservices</code> and <code>restlets</code> scopes. With only the first, queries work but schema discovery fails with a 401.</p>
    </fieldset>

    <label for="restletUrl">RESTlet URL (optional)</label>
    <input id="restletUrl" type="text" placeholder="https://<account>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=...&deploy=..." autocomplete="off">
    <p class="hint">Enables schema discovery via a custom RESTlet — leave blank to add later.</p>

    <div id="status" role="status"></div>

    <div class="actions">
      <button type="button" id="test-connection">Test Connection</button>
      <button type="submit" id="save-and-connect">Save &amp; Connect</button>
      <button type="button" id="cancel" class="secondary">Cancel</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
