import type { ConnectionDialogFormInput, ConnectionDialogInboundMessage, ConnectionDialogOutboundMessage } from "../connectionDialogProtocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: ConnectionDialogInboundMessage): void;
};

const vscode = acquireVsCodeApi();

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el as T;
}

const form = byId<HTMLFormElement>("connection-form");
const statusEl = byId<HTMLDivElement>("status");
const testButton = byId<HTMLButtonElement>("test-connection");
const saveButton = byId<HTMLButtonElement>("save-and-connect");
const cancelButton = byId<HTMLButtonElement>("cancel");

function readForm(): ConnectionDialogFormInput {
  return {
    label: byId<HTMLInputElement>("label").value.trim(),
    realm: byId<HTMLInputElement>("realm").value.trim(),
    consumerKey: byId<HTMLInputElement>("consumerKey").value.trim(),
    consumerSecret: byId<HTMLInputElement>("consumerSecret").value,
    tokenKey: byId<HTMLInputElement>("tokenKey").value.trim(),
    tokenSecret: byId<HTMLInputElement>("tokenSecret").value,
    restletUrl: byId<HTMLInputElement>("restletUrl").value.trim() || undefined,
  };
}

function setStatus(text: string, kind: "info" | "success" | "error"): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function setBusy(busy: boolean): void {
  testButton.disabled = busy;
  saveButton.disabled = busy;
}

testButton.addEventListener("click", () => {
  setBusy(true);
  setStatus("Testing connection…", "info");
  vscode.postMessage({ type: "testConnection", profile: readForm() });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  setBusy(true);
  setStatus("Saving and connecting…", "info");
  vscode.postMessage({ type: "saveAndConnect", profile: readForm() });
});

cancelButton.addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
});

window.addEventListener("message", (event: MessageEvent<ConnectionDialogOutboundMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      return;

    case "testConnectionStarted":
      return;

    case "testConnectionResult":
      setBusy(false);
      setStatus(
        message.status === "success" ? message.message : `Connection failed: ${message.message}`,
        message.status === "success" ? "success" : "error",
      );
      return;

    case "saveAndConnectStarted":
      return;

    case "saveAndConnectCommitting":
      cancelButton.disabled = true;
      setStatus("Saving connection…", "info");
      return;

    case "saveAndConnectResult":
      if (message.status === "success") {
        setStatus(`Connected to "${message.label}".`, "success");
      } else {
        setBusy(false);
        cancelButton.disabled = false;
        setStatus(`Failed to save connection: ${message.message}`, "error");
      }
      return;
  }
});

vscode.postMessage({ type: "ready" });
