import * as vscode from "vscode";
import { setAttributionSink } from "@monty-nabil/netsuite-api-client-ts";
import { ActiveConnectionManager } from "./connection/activeConnection.js";
import { ConnectionProfileStore } from "./connection/connectionProfileStore.js";
import { ConnectionService } from "./connection/connectionService.js";
import { SecretStore } from "./connection/secretStore.js";
import { openConnectionDialog } from "./connectionDialog/connectionDialogController.js";
import { getOutputChannel, logError, logInfo } from "./outputChannel.js";
import { ObjectExplorerProvider } from "./objectExplorer/objectExplorerProvider.js";
import { ConnectionRootNode } from "./objectExplorer/nodes.js";
import { getAuthType, validateRestletUrl, type AuthType, type ConnectionProfile } from "./connection/connectionProfile.js";
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

/**
 * Asks which authentication method a new connection uses, before the dialog opens, so the
 * form only ever shows the fields that apply. Returns undefined if the user dismissed it.
 *
 * The dialog still carries a radio toggle prefilled with this choice — picking here first
 * keeps the form short, but shouldn't trap someone who picked the wrong one.
 */
async function pickAuthType(): Promise<AuthType | undefined> {
  const options: Array<vscode.QuickPickItem & { authType: AuthType }> = [
    {
      authType: "tba",
      label: "OAuth 1.0a — Token-Based Authentication",
      detail: "Consumer key/secret and token ID/secret. NetSuite blocks new TBA integrations from 2027.1.",
    },
    {
      authType: "m2m",
      label: "OAuth 2.0 — Client Credentials (M2M)",
      detail: "Client ID, certificate ID, and a private key. Recommended for new integrations.",
    },
  ];

  const picked = await vscode.window.showQuickPick(options, {
    title: "Add NetSuite Connection",
    placeHolder: "How should this connection authenticate?",
    ignoreFocusOut: true,
  });
  return picked?.authType;
}

export function activate(context: vscode.ExtensionContext): void {
  // Before any client exists: the library emits its attribution banner on first client
  // construction, and without this it would go to the default stderr sink and land in the
  // Extension Host log, where no user of this extension would ever see it. "plain" rather
  // than the default half-block art because the output channel's line height stretches
  // half-blocks enough that the QR stops scanning.
  setAttributionSink((text) => getOutputChannel().appendLine(text));

  const profileStore = new ConnectionProfileStore();
  const secretStore = new SecretStore(context.secrets);
  const activeConnection = new ActiveConnectionManager();
  const connectionService = new ConnectionService(profileStore, secretStore, activeConnection);
  persistActiveConnectionAcrossRestarts(context, activeConnection);

  // Logged from the transition itself rather than at each call site, so every route into
  // a connection is covered: adding one, switching, and the silent restore after a
  // restart. Disconnects were previously not recorded at all, which made the log hard to
  // read back — connections appeared to overlap.
  context.subscriptions.push(
    activeConnection.onDidChangeActiveConnection((active) => {
      if (active) {
        const authLabel = getAuthType(active.profile) === "m2m" ? "OAuth 2.0 (M2M)" : "OAuth 1.0a (TBA)";
        logInfo(`Connected to "${active.profile.label}" (${active.profile.realm}) via ${authLabel}.`);
      } else {
        logInfo("Disconnected.");
      }
    }),
  );

  const schemaCacheStore = new SchemaCacheStore(context.globalStorageUri);
  const schemaDownloadService = new SchemaDownloadService(schemaCacheStore);
  const activeSchemaCache = new ActiveSchemaCache(activeConnection, schemaCacheStore);
  const objectExplorerProvider = new ObjectExplorerProvider(activeConnection, activeSchemaCache, profileStore);

  const resultsViewProvider = new ResultsViewProvider(context.extensionUri, activeConnection, activeSchemaCache);

  context.subscriptions.push(activeConnection, activeSchemaCache, objectExplorerProvider, resultsViewProvider);
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

  /**
   * The newest "Add Tables to Schema" run, if still going. Starting another run (or clearing
   * the cache) invalidates it: two runs for the same connection would each load the cache
   * from disk independently, and whichever saved last would drop the other's tables — and a
   * run left alone after "Clear Schema Cache" would write the cleared cache straight back.
   * Newest-wins rather than rejecting the new run, since the older one can be stuck in
   * retries for a long while before its progress notification (and cancel button) appears.
   */
  let inFlightSchemaDownload: { invalidate(): void } | undefined;

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

    // A download belongs to one connection *generation*: this exact `ActiveConnection`
    // object. `connect()` and `updateActiveProfile()` (e.g. a RESTlet URL edit) each replace
    // it with a new object, so identity changes on every connect/disconnect *and* every
    // profile update. Comparing values instead (epoch + URL) would let a superseded run
    // match again after the URL goes A -> B -> A. Once stale, a run stays stale: the latch
    // below never resets, and it can also be tripped explicitly (see `inFlightSchemaDownload`).
    let invalidated = false;
    const isCurrent = (): boolean => {
      if (!invalidated && activeConnection.get() !== active) {
        invalidated = true;
      }
      return !invalidated;
    };

    const abortController = new AbortController();
    const connectionListener = activeConnection.onDidChangeActiveConnection(() => {
      if (!isCurrent()) {
        abortController.abort();
      }
    });
    const thisDownload = {
      invalidate(): void {
        invalidated = true;
        abortController.abort();
      },
    };
    inFlightSchemaDownload?.invalidate();
    inFlightSchemaDownload = thisDownload;

    let outcome;
    try {
      outcome = await schemaDownloadService.runInteractive(active.profile.id, active.profile.realm, active.getRestletClient(), restletUrl, {
        isCurrent,
        signal: abortController.signal,
      });
    } catch (error) {
      logError("Failed to download schema", error);
      void vscode.window.showErrorMessage(
        `SuiteQL: failed to download schema — ${error instanceof Error ? error.message : String(error)} (see the "SuiteQL" output channel for details).`,
      );
      return;
    } finally {
      connectionListener.dispose();
      if (inFlightSchemaDownload === thisDownload) {
        inFlightSchemaDownload = undefined;
      }
    }
    if (!outcome) {
      return;
    }

    // The download can take a while (progress-reported, cancellable), and the connection it
    // was for may have stopped being the live one meanwhile. runInteractive already refused to
    // persist anything in that case (the cache store is keyed only by profile id, so a stale
    // save would clobber the new generation's cache on disk); re-checking the same `isCurrent`
    // here keeps the live, in-memory cache consistent with that decision.
    if (outcome.superseded || !isCurrent()) {
      logInfo(`Schema download for "${active.profile.label}" finished after the active connection changed; discarded it.`);
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
    vscode.commands.registerCommand("suiteql.addConnection", async () => {
      const authType = await pickAuthType();
      if (!authType) {
        return; // dismissed the picker — don't open a dialog they didn't ask for
      }
      openConnectionDialog(
        context,
        connectionService,
        activeConnection,
        resultsViewProvider,
        async (profile) => {
          void vscode.window.showInformationMessage(`SuiteQL: connected to "${profile.label}".`);
          await addTablesToSchema();
        },
        authType,
      );
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
    vscode.commands.registerCommand("suiteql.activateConnectionById", async (target?: string | ConnectionRootNode) => {
      const profileId = typeof target === "string" ? target : target?.profileId;
      if (!profileId) {
        await vscode.commands.executeCommand("suiteql.selectConnection");
        return;
      }
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
      // Update the profile *before* dropping the old cache: that's what flips any in-flight
      // "Add Tables to Schema" run for the old URL to superseded, so it can't save its stale
      // result back to disk after the delete below.
      await connectionService.setRestletUrl(profile.id, newRestletUrl);
      if (newRestletUrl !== profile.restletUrl) {
        // The cached schema was gathered from the *old* endpoint — its columns are stale
        // the moment the URL changes, not just next time "Add Tables to Schema" runs.
        await schemaCacheStore.delete(profile.id);
        if (profile.id === activeConnection.get()?.profile.id) {
          activeSchemaCache.set(emptySchemaCache(profile.id, profile.realm));
        }
      }

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

      if (target.id === activeConnection.get()?.profile.id) {
        inFlightSchemaDownload?.invalidate(); // otherwise it would save its cache right back
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
    .then((restored) => {
      const active = activeConnection.get();
      if (restored && active) {
        logInfo(`Restored connection "${active.profile.label}" from the previous session.`);
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
