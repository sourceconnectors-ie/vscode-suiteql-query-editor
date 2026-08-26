import * as vscode from "vscode";
import type { ActiveConnectionManager } from "./activeConnection.js";
import type { ConnectionService } from "./connectionService.js";

const LAST_ACTIVE_CONNECTION_KEY = "suiteql.lastActiveConnectionId";

/**
 * Remembers which connection was active in `globalState` so it can be restored on the
 * next activation. An explicit disconnect clears this (the listener fires with
 * `undefined`), so restarting after disconnecting does NOT reconnect automatically —
 * only closing/reloading VS Code while still connected does.
 */
export function persistActiveConnectionAcrossRestarts(
  context: vscode.ExtensionContext,
  activeConnection: ActiveConnectionManager,
): void {
  context.subscriptions.push(
    activeConnection.onDidChangeActiveConnection((active) => {
      void context.globalState.update(LAST_ACTIVE_CONNECTION_KEY, active?.profile.id);
    }),
  );
}

/** Silently reconnects to whatever was active last session, if it still exists. */
export async function restoreLastActiveConnection(
  context: vscode.ExtensionContext,
  connectionService: ConnectionService,
): Promise<void> {
  const lastActiveId = context.globalState.get<string>(LAST_ACTIVE_CONNECTION_KEY);
  if (!lastActiveId) {
    return;
  }

  const profile = connectionService.getAllProfiles().find((candidate) => candidate.id === lastActiveId);
  if (!profile) {
    return;
  }

  await connectionService.activate(profile);
}
