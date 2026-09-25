import * as vscode from "vscode";
import type { ActiveConnection, ActiveConnectionManager } from "../connection/activeConnection.js";
import { getAuthType } from "../connection/connectionProfile.js";

/** Shows the single active connection's label/state, and opens the connection switcher on click. */
export class ConnectionStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly listener: vscode.Disposable;

  constructor(activeConnection: ActiveConnectionManager, command: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = command;
    this.listener = activeConnection.onDidChangeActiveConnection((active) => this.render(active));
    this.render(activeConnection.get());
    this.item.show();
  }

  private render(active: ActiveConnection | undefined): void {
    if (active) {
      // The method goes in the tooltip rather than the label — the status bar is shared
      // real estate, and the label already carries the part that changes most often.
      const authLabel = getAuthType(active.profile) === "m2m" ? "OAuth 2.0 (M2M)" : "OAuth 1.0a (TBA)";
      this.item.text = `$(plug) SuiteQL: ${active.profile.label}`;
      this.item.tooltip = `Connected to ${active.profile.realm} via ${authLabel}. Click to switch connection.`;
    } else {
      this.item.text = "$(debug-disconnect) SuiteQL: Disconnected";
      this.item.tooltip = "Click to select or add a NetSuite connection.";
    }
  }

  dispose(): void {
    this.listener.dispose();
    this.item.dispose();
  }
}
