import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { ActiveConnectionManager } from "../connection/activeConnection.js";
import { confirmDisconnectIfRunning } from "../connection/confirmDisconnect.js";
import type { ConnectionProfile, ConnectionProfileInput } from "../connection/connectionProfile.js";
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
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );
  currentPanel = panel;

  panel.webview.html = renderHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message: ConnectionDialogInboundMessage) => {
    switch (message.type) {
      case "ready":
        post(panel, { type: "init" });
        return;

      case "testConnection": {
        post(panel, { type: "testConnectionStarted" });
        const result = await connectionService.testConnection(message.profile);
        post(panel, {
          type: "testConnectionResult",
          status: result.success ? "success" : "failed",
          message: result.message,
        });
        return;
      }

      case "saveAndConnect": {
        post(panel, { type: "saveAndConnectStarted" });
        if ((await confirmDisconnectIfRunning(activeConnection, resultsView)) === "abort") {
          post(panel, { type: "saveAndConnectResult", status: "failed", message: "Cancelled." });
          return;
        }
        try {
          const profile = await saveAndConnect(connectionService, message.profile);
          post(panel, { type: "saveAndConnectResult", status: "success", label: profile.label });
          panel.dispose();
          await onConnected(profile);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError("Failed to save/activate connection", error);
          post(panel, { type: "saveAndConnectResult", status: "failed", message: errorMessage });
        }
        return;
      }

      case "cancel":
        panel.dispose();
        return;
    }
  });

  panel.onDidDispose(() => {
    currentPanel = undefined;
  });
}

async function saveAndConnect(
  connectionService: ConnectionService,
  form: ConnectionProfileInput,
): Promise<ConnectionProfile> {
  const testResult = await connectionService.testConnection(form);
  if (!testResult.success) {
    throw new Error(testResult.message);
  }
  return connectionService.addConnectionAndActivate(form);
}

function post(panel: vscode.WebviewPanel, message: ConnectionDialogOutboundMessage): void {
  void panel.webview.postMessage(message);
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
