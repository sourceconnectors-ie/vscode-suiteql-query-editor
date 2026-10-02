import type { AuthType, JwtAlgorithm } from "../connection/connectionProfile.js";

/**
 * Form fields collected by the connection dialog webview, one shape per auth method.
 *
 * Structurally this mirrors `ConnectionProfileInput`, but it stays a separate declaration
 * because it crosses the webview boundary: everything here has to survive
 * `postMessage` structured cloning, so it can only ever be plain data.
 */
interface BaseDialogFormInput {
  label: string;
  realm: string;
  restletUrl?: string;
  baseUrlOverride?: string;
}

export interface TbaDialogFormInput extends BaseDialogFormInput {
  authType: "tba";
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
}

export interface M2mDialogFormInput extends BaseDialogFormInput {
  authType: "m2m";
  clientId: string;
  certificateId: string;
  /** PEM content — pasted, or read host-side from a file the user picked. Never a path. */
  privateKey: string;
  jwtAlgorithm: JwtAlgorithm;
}

export type ConnectionDialogFormInput = TbaDialogFormInput | M2mDialogFormInput;

export type ConnectionDialogInboundMessage =
  | { type: "ready" }
  | { type: "testConnection"; profile: ConnectionDialogFormInput }
  | { type: "saveAndConnect"; profile: ConnectionDialogFormInput }
  /**
   * Asks the host to open a file picker for the M2M private key. The webview can't read
   * files itself, and the host deliberately returns the *contents* rather than the path —
   * the key belongs in SecretStorage, and a path would break the moment the file moved.
   */
  | { type: "browseForPrivateKey" }
  | { type: "cancel" };

export type ConnectionDialogOutboundMessage =
  /** Carries the auth method the user picked before the dialog opened. */
  | { type: "init"; authType: AuthType }
  | { type: "testConnectionStarted" }
  | { type: "testConnectionResult"; status: "success" | "failed"; message: string }
  | { type: "saveAndConnectStarted" }
  /** Past the point of no return: the profile and secrets are being written. */
  | { type: "saveAndConnectCommitting" }
  | { type: "saveAndConnectResult"; status: "success"; label: string }
  | { type: "saveAndConnectResult"; status: "failed"; message: string }
  /** Result of a `browseForPrivateKey`; `cancelled` when the user dismissed the picker. */
  | { type: "privateKeyFileRead"; status: "success"; contents: string; fileName: string }
  | { type: "privateKeyFileRead"; status: "failed"; message: string }
  | { type: "privateKeyFileRead"; status: "cancelled" };
