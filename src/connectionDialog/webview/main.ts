import type { AuthType, JwtAlgorithm } from "../../connection/connectionProfile.js";
import type {
  ConnectionDialogFormInput,
  ConnectionDialogInboundMessage,
  ConnectionDialogOutboundMessage,
} from "../connectionDialogProtocol.js";

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
const browseButton = byId<HTMLButtonElement>("browse-private-key");
const privateKeyNote = byId<HTMLSpanElement>("private-key-note");
const tbaFields = byId<HTMLFieldSetElement>("tba-fields");
const m2mFields = byId<HTMLFieldSetElement>("m2m-fields");

let authType: AuthType = "tba";

/**
 * Shows one auth method's fields and hides the other's.
 *
 * `disabled` does the real work here, not just the `hidden` attribute: a hidden input
 * that's still `required` blocks submit while being impossible to fill in, and the
 * browser reports "An invalid form control is not focusable" with nothing visible to
 * fix. Disabled controls are skipped by validation, and are left out of the form
 * entirely — which is also what we want, since only one method's values are ever read.
 */
function applyAuthType(next: AuthType): void {
  authType = next;

  const showingM2m = next === "m2m";
  tbaFields.hidden = showingM2m;
  tbaFields.disabled = showingM2m;
  m2mFields.hidden = !showingM2m;
  m2mFields.disabled = !showingM2m;

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="authType"]')) {
    radio.checked = radio.value === next;
  }
}

function readForm(): ConnectionDialogFormInput {
  const label = byId<HTMLInputElement>("label").value.trim();
  const realm = byId<HTMLInputElement>("realm").value.trim();
  const restletUrl = byId<HTMLInputElement>("restletUrl").value.trim() || undefined;
  const baseUrlOverride = byId<HTMLInputElement>("baseUrlOverride").value.trim() || undefined;

  if (authType === "m2m") {
    return {
      authType: "m2m",
      label,
      realm,
      clientId: byId<HTMLInputElement>("clientId").value.trim(),
      certificateId: byId<HTMLInputElement>("certificateId").value.trim(),
      // Not trimmed to a single line: a PEM is multi-line and its body is significant.
      // Only surrounding whitespace goes.
      privateKey: byId<HTMLTextAreaElement>("privateKey").value.trim(),
      jwtAlgorithm: byId<HTMLSelectElement>("jwtAlgorithm").value as JwtAlgorithm,
      restletUrl,
      baseUrlOverride,
    };
  }

  return {
    authType: "tba",
    label,
    realm,
    consumerKey: byId<HTMLInputElement>("consumerKey").value.trim(),
    consumerSecret: byId<HTMLInputElement>("consumerSecret").value,
    tokenKey: byId<HTMLInputElement>("tokenKey").value.trim(),
    tokenSecret: byId<HTMLInputElement>("tokenSecret").value,
    restletUrl,
    baseUrlOverride,
  };
}

function setStatus(text: string, kind: "info" | "success" | "error"): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function setBusy(busy: boolean): void {
  testButton.disabled = busy;
  saveButton.disabled = busy;
  browseButton.disabled = busy;
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="authType"]')) {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      applyAuthType(radio.value as AuthType);
      setStatus("", "info");
    }
  });
}

browseButton.addEventListener("click", () => {
  browseButton.disabled = true;
  vscode.postMessage({ type: "browseForPrivateKey" });
});

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
      applyAuthType(message.authType);
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

    case "privateKeyFileRead":
      browseButton.disabled = false;
      if (message.status === "success") {
        byId<HTMLTextAreaElement>("privateKey").value = message.contents.trim();
        privateKeyNote.textContent = `Loaded from ${message.fileName}`;
      } else if (message.status === "failed") {
        privateKeyNote.textContent = "";
        setStatus(`Couldn't read that key file: ${message.message}`, "error");
      }
      return;
  }
});

applyAuthType("tba");
vscode.postMessage({ type: "ready" });
