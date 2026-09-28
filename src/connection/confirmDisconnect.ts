import * as vscode from "vscode";
import type { ResultsViewProvider } from "../resultsPane/resultsViewProvider.js";
import type { ActiveConnectionManager } from "./activeConnection.js";

/**
 * Call before anything that would disconnect the active connection (an explicit
 * disconnect, switching to a different connection, removing the active profile, or
 * activating a brand-new one). If a query is currently running on it, asks the user
 * whether to wait for it, stop it and disconnect anyway, or abort the disconnect
 * entirely. Returns "proceed" immediately if nothing is running.
 */
export async function confirmDisconnectIfRunning(
  activeConnection: ActiveConnectionManager,
  resultsView: ResultsViewProvider,
): Promise<"proceed" | "abort"> {
  const active = activeConnection.get();
  if (!active || !resultsView.isAnyExecutionRunning()) {
    return "proceed";
  }

  const choice = await vscode.window.showWarningMessage(
    `A query is still running on "${active.profile.label}". Disconnecting now will abandon its results.`,
    { modal: true },
    "Wait for it to finish",
    "Stop and Disconnect",
  );

  if (choice === "Wait for it to finish") {
    await resultsView.waitForCurrentExecution();
    return "proceed";
  }
  if (choice === "Stop and Disconnect") {
    resultsView.requestCancelCurrentExecution();
    return "proceed";
  }
  return "abort";
}
