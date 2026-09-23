import * as vscode from "vscode";
import type { ActiveConnection, ActiveConnectionManager } from "../connection/activeConnection.js";

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
      this.item.text = `$(plug) SuiteQL: ${active.profile.label}`;
      this.item.tooltip = `Connected to ${active.profile.realm}. Click to switch connection.`;
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
