import * as vscode from "vscode";
import { ActiveConnectionManager } from "./connection/activeConnection.js";
import { ConnectionProfileStore } from "./connection/connectionProfileStore.js";
import { ConnectionService } from "./connection/connectionService.js";
import { SecretStore } from "./connection/secretStore.js";
import { openConnectionDialog } from "./connectionDialog/connectionDialogController.js";
import { getOutputChannel, logError, logInfo } from "./outputChannel.js";
import { ObjectExplorerProvider } from "./objectExplorer/objectExplorerProvider.js";
import { ConnectionRootNode } from "./objectExplorer/nodes.js";
import { validateRestletUrl, type ConnectionProfile } from "./connection/connectionProfile.js";
import { ActiveSchemaCache } from "./schemaCache/activeSchemaCache.js";
import { SchemaCacheStore } from "./schemaCache/schemaCacheStore.js";
import { emptySchemaCache } from "./schemaCache/schemaCacheTypes.js";
import { SchemaDownloadService } from "./schemaCache/schemaDownloadService.js";
import { SchemaDragAndDropController } from "./objectExplorer/schemaDragAndDropController.js";
import { registerInsertIdentifierCommand } from "./queryEditor/insertIdentifierCommand.js";
import { registerSchemaIdentifierDropEditProvider } from "./queryEditor/schemaIdentifierDropEditProvider.js";
import { registerNewQueryCommand } from "./queryEditor/languageContribution.js";
import { registerRunQueryCommand } from "./queryEditor/runQueryCommand.js";
import { ResultsViewProvider } from "./resultsPane/resultsViewProvider.js";
import { registerCompletionProvider } from "./completion/completionProvider.js";
import { registerSemanticTokensProvider } from "./completion/semanticTokensProvider.js";
import { ConnectionStatusBarItem } from "./statusBar/connectionStatusBarItem.js";
import { persistActiveConnectionAcrossRestarts, restoreLastActiveConnection } from "./connection/lastActiveConnection.js";
import { confirmDisconnectIfRunning } from "./connection/confirmDisconnect.js";

export function activate(context: vscode.ExtensionContext): void {
  const profileStore = new ConnectionProfileStore();
  const secretStore = new SecretStore(context.secrets);
  const activeConnection = new ActiveConnectionManager();
  const connectionService = new ConnectionService(profileStore, secretStore, activeConnection);
  persistActiveConnectionAcrossRestarts(context, activeConnection);

  const schemaCacheStore = new SchemaCacheStore(context.globalStorageUri);
  const schemaDownloadService = new SchemaDownloadService(schemaCacheStore);
  const activeSchemaCache = new ActiveSchemaCache(activeConnection, schemaCacheStore);
  const objectExplorerProvider = new ObjectExplorerProvider(activeConnection, activeSchemaCache, profileStore);

  const resultsViewProvider = new ResultsViewProvider(context.extensionUri, activeConnection, activeSchemaCache);

  context.subscriptions.push(activeConnection);
  const objectExplorerTreeView = vscode.window.createTreeView("suiteql.objectExplorer", {
    treeDataProvider: objectExplorerProvider,
    dragAndDropController: new SchemaDragAndDropController(),
  });
  context.subscriptions.push(objectExplorerTreeView);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("suiteql.resultsPane", resultsViewProvider));

  function updateSchemaFilterUi(): void {
    const filter = objectExplorerProvider.getFilter();
    objectExplorerTreeView.message = filter ? `Filtering schema: "${filter}"` : undefined;
    void vscode.commands.executeCommand("setContext", "suiteql.schemaFilterActive", Boolean(filter));
  }
  updateSchemaFilterUi();

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.filterSchema", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Filter tables and columns (matches names)",
        placeHolder: "e.g. customer, entityid, salesorder",
        value: objectExplorerProvider.getFilter() ?? "",
      });
      if (input === undefined) {
        return;
      }
      objectExplorerProvider.setFilter(input);
      updateSchemaFilterUi();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.clearSchemaFilter", () => {
      objectExplorerProvider.setFilter(undefined);
      updateSchemaFilterUi();
    }),
  );

  registerNewQueryCommand(context);
  registerRunQueryCommand(context, activeConnection, resultsViewProvider);
  registerInsertIdentifierCommand(context);
  registerSchemaIdentifierDropEditProvider(context);
  registerCompletionProvider(context, activeConnection, activeSchemaCache);
  registerSemanticTokensProvider(context, activeConnection, activeSchemaCache);
  context.subscriptions.push(new ConnectionStatusBarItem(activeConnection, "suiteql.selectConnection"));

  async function activateConnection(profile: ConnectionProfile): Promise<void> {
    if ((await confirmDisconnectIfRunning(activeConnection, resultsViewProvider)) === "abort") {
      return;
    }
    try {
      await connectionService.activate(profile);
      void vscode.window.showInformationMessage(`SuiteQL: connected to "${profile.label}".`);
    } catch (error) {
      logError(`Failed to activate connection "${profile.label}"`, error);
      void vscode.window.showErrorMessage(
        `SuiteQL: failed to connect — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Returns the profile's RESTlet URL, or `undefined` (after warning, with an offer to set one) if it has none. */
  async function requireRestletUrl(profileId: string, restletUrl: string | undefined): Promise<string | undefined> {
    if (restletUrl) {
      return restletUrl;
    }
    const action = await vscode.window.showWarningMessage(
      "SuiteQL: this connection has no RESTlet URL set — schema discovery is disabled.",
      "Set RESTlet URL",
    );
    if (action === "Set RESTlet URL") {
      await vscode.commands.executeCommand("suiteql.setRestletUrl", profileId);
    }
    return undefined;
  }

  async function addTablesToSchema(): Promise<void> {
    const active = activeConnection.get();
    if (!active) {
      void vscode.window.showErrorMessage("SuiteQL: no active connection. Add or select a connection first.");
      return;
    }
    const restletUrl = await requireRestletUrl(active.profile.id, active.profile.restletUrl);
    if (!restletUrl) {
      return;
    }

    let outcome;
    try {
      outcome = await schemaDownloadService.runInteractive(active.profile.id, active.profile.realm, active.config, restletUrl);
    } catch (error) {
      logError("Failed to download schema", error);
      void vscode.window.showErrorMessage(
        `SuiteQL: failed to download schema — ${error instanceof Error ? error.message : String(error)} (see the "SuiteQL" output channel for details).`,
      );
      return;
    }
    if (!outcome) {
      return;
    }

    activeSchemaCache.set(outcome.cache);
    if (outcome.addedCount > 0 || outcome.failedCount > 0) {
      void vscode.window.showInformationMessage(
        `SuiteQL: added ${outcome.addedCount} table(s) to the schema${outcome.failedCount > 0 ? ` (${outcome.failedCount} failed)` : ""}.`,
      );
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.addConnection", () => {
      openConnectionDialog(context, connectionService, activeConnection, resultsViewProvider, async (profile) => {
        logInfo(`Connected to "${profile.label}" (${profile.realm}).`);
        void vscode.window.showInformationMessage(`SuiteQL: connected to "${profile.label}".`);
        await addTablesToSchema();
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.removeConnection", async (node?: ConnectionRootNode) => {
      const profiles = connectionService.getAllProfiles();
      let target = node ? profiles.find((profile) => profile.id === node.profileId) : undefined;

      if (!target) {
        if (profiles.length === 0) {
          void vscode.window.showInformationMessage("SuiteQL: no saved connections.");
          return;
        }

        const picked = await vscode.window.showQuickPick(
          profiles.map((profile) => ({ label: profile.label, description: profile.realm, id: profile.id })),
          { placeHolder: "Select a connection to remove" },
        );
        if (!picked) {
          return;
        }
        target = profiles.find((profile) => profile.id === picked.id);
      }

      if (!target) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete connection "${target.label}"? This removes its saved profile and stored secrets — you'd need to re-enter them to recreate it.`,
        { modal: true },
        "Delete",
      );
      if (confirmed !== "Delete") {
        return;
      }

      if (target.id === activeConnection.get()?.profile.id) {
        if ((await confirmDisconnectIfRunning(activeConnection, resultsViewProvider)) === "abort") {
          return;
        }
      }

      await connectionService.removeConnection(target.id);
      await schemaCacheStore.delete(target.id);
      objectExplorerProvider.refresh();
      void vscode.window.showInformationMessage(`SuiteQL: removed connection "${target.label}".`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.disconnectConnection", async () => {
      const active = activeConnection.get();
      if (!active) {
        void vscode.window.showInformationMessage("SuiteQL: no active connection.");
        return;
      }
      if ((await confirmDisconnectIfRunning(activeConnection, resultsViewProvider)) === "abort") {
        return;
      }
      activeConnection.disconnect();
      void vscode.window.showInformationMessage(`SuiteQL: disconnected from "${active.profile.label}".`);
    }),
  );

  context.subscriptions.push(vscode.commands.registerCommand("suiteql.addTablesToSchema", addTablesToSchema));

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.selectConnection", async () => {
      const profiles = connectionService.getAllProfiles();
      const activeId = activeConnection.get()?.profile.id;

      const items: Array<vscode.QuickPickItem & { profileId?: string; addNew?: boolean }> = [
        ...profiles.map((profile) => ({
          label: `${profile.id === activeId ? "$(check) " : ""}${profile.label}`,
          description: profile.realm,
          profileId: profile.id,
        })),
        { label: "$(add) Add New Connection…", addNew: true },
      ];

      const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select a NetSuite connection" });
      if (!picked) {
        return;
      }

      if (picked.addNew) {
        await vscode.commands.executeCommand("suiteql.addConnection");
        return;
      }

      const profile = profiles.find((candidate) => candidate.id === picked.profileId);
      if (!profile) {
        return;
      }

      await activateConnection(profile);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.activateConnectionById", async (target: string | ConnectionRootNode) => {
      const profileId = typeof target === "string" ? target : target.profileId;
      const profile = connectionService.getAllProfiles().find((candidate) => candidate.id === profileId);
      if (!profile) {
        return;
      }
      await activateConnection(profile);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.setRestletUrl", async (target?: string | ConnectionRootNode) => {
      const profiles = connectionService.getAllProfiles();
      let profileId = typeof target === "string" ? target : target?.profileId;

      if (!profileId) {
        if (profiles.length === 0) {
          void vscode.window.showInformationMessage("SuiteQL: no saved connections.");
          return;
        }
        const picked = await vscode.window.showQuickPick(
          profiles.map((profile) => ({ label: profile.label, description: profile.realm, id: profile.id })),
          { placeHolder: "Select a connection" },
        );
        if (!picked) {
          return;
        }
        profileId = picked.id;
      }

      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        return;
      }

      const input = await vscode.window.showInputBox({
        prompt: `RESTlet URL for "${profile.label}" (enables schema discovery)`,
        placeHolder: "https://<account>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=...&deploy=...",
        value: profile.restletUrl ?? "",
        validateInput: (value) => validateRestletUrl(value),
      });
      if (input === undefined) {
        return;
      }

      const newRestletUrl = input.trim() || undefined;
      if (newRestletUrl !== profile.restletUrl) {
        // The cached schema was gathered from the *old* endpoint — its columns are stale
        // the moment the URL changes, not just next time "Add Tables to Schema" runs.
        await schemaCacheStore.delete(profile.id);
        if (profile.id === activeConnection.get()?.profile.id) {
          activeSchemaCache.set(emptySchemaCache(profile.id, profile.realm));
        }
      }

      await connectionService.setRestletUrl(profile.id, newRestletUrl);
      objectExplorerProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("suiteql.clearSchemaCache", async (node?: ConnectionRootNode) => {
      const profiles = connectionService.getAllProfiles();
      let target = node ? profiles.find((profile) => profile.id === node.profileId) : undefined;

      if (!target) {
        if (profiles.length === 0) {
          void vscode.window.showInformationMessage("SuiteQL: no saved connections.");
          return;
        }
        const picked = await vscode.window.showQuickPick(
          profiles.map((profile) => ({ label: profile.label, description: profile.realm, id: profile.id })),
          { placeHolder: "Select a connection to clear its schema cache" },
        );
        if (!picked) {
          return;
        }
        target = profiles.find((profile) => profile.id === picked.id);
      }

      if (!target) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Clear the cached schema for "${target.label}"? You'll need to run "Add Tables to Schema" again to repopulate it.`,
        { modal: true },
        "Clear",
      );
      if (confirmed !== "Clear") {
        return;
      }

      await schemaCacheStore.delete(target.id);
      if (target.id === activeConnection.get()?.profile.id) {
        activeSchemaCache.set(emptySchemaCache(target.id, target.realm));
      }
      objectExplorerProvider.refresh();
      void vscode.window.showInformationMessage(`SuiteQL: cleared schema cache for "${target.label}".`);
    }),
  );

  void restoreLastActiveConnection(context, connectionService)
    .then(() => {
      const restored = activeConnection.get();
      if (restored) {
        logInfo(`Restored connection "${restored.profile.label}" from the previous session.`);
      }
    })
    .catch((error: unknown) => {
      logError("Failed to restore the previously active connection", error);
    });

  logInfo("SuiteQL Query Editor activated.");
}

export function deactivate(): void {
  getOutputChannel().dispose();
}
