/** Form fields collected by the connection dialog webview. */
export interface ConnectionDialogFormInput {
  label: string;
  realm: string;
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
  restletUrl?: string;
}

export type ConnectionDialogInboundMessage =
  | { type: "ready" }
  | { type: "testConnection"; profile: ConnectionDialogFormInput }
  | { type: "saveAndConnect"; profile: ConnectionDialogFormInput }
  | { type: "cancel" };

export type ConnectionDialogOutboundMessage =
  | { type: "init" }
  | { type: "testConnectionStarted" }
  | { type: "testConnectionResult"; status: "success" | "failed"; message: string }
  | { type: "saveAndConnectStarted" }
  /** Past the point of no return: the profile and secrets are being written. */
  | { type: "saveAndConnectCommitting" }
  | { type: "saveAndConnectResult"; status: "success"; label: string }
  | { type: "saveAndConnectResult"; status: "failed"; message: string };
