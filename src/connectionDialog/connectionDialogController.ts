import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import { confirmDisconnectIfRunning } from "../connection/confirmDisconnect.js";
import type { ConnectionProfile } from "../connection/connectionProfile.js";
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
        post({ type: "init" });
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

    <label for="label">Label</label>
    <input id="label" type="text" placeholder="e.g. Production, Sandbox1" required autocomplete="off">

    <label for="realm">Account ID / realm</label>
    <input id="realm" type="text" placeholder="e.g. 1234567_SB1" required autocomplete="off">

    <label for="consumerKey">Consumer key</label>
    <input id="consumerKey" type="text" required autocomplete="off">

    <label for="consumerSecret">Consumer secret</label>
    <input id="consumerSecret" type="password" required autocomplete="off">

    <label for="tokenKey">Token ID</label>
    <input id="tokenKey" type="text" required autocomplete="off">

    <label for="tokenSecret">Token secret</label>
    <input id="tokenSecret" type="password" required autocomplete="off">

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
