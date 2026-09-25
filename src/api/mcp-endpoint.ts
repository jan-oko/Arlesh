import { invoke } from "./gesture";

/**
 * The MCP endpoint's listener: which port it binds, and whether it is listening (see
 * docs/spec/mcp-server.md, "Address").
 *
 * The port is the user's setting unless `ARLESH_MCP_PORT` overrides it. A port that cannot be bound
 * — most often because another Arlesh holds it — is reported as `failed` with the reason, and a
 * restart or a new port tries again without restarting the app.
 */

/** What the listener is doing. */
export type McpListenerState =
  | { state: "starting" }
  | { state: "listening"; address: string }
  | { state: "failed"; reason: string };

/** The endpoint as the settings page shows it. */
export interface McpEndpointStatus {
  listener: McpListenerState;
  /** The port the listener last tried: the override when set, else the setting. */
  port: number;
  /** The port the user chose, or the default. */
  configured_port: number;
  /** The port `ARLESH_MCP_PORT` sets, which wins over the setting while it is set. */
  env_override: number | null;
}

/** The listener as it stands. */
export async function fetchMcpEndpointStatus(): Promise<McpEndpointStatus> {
  return invoke<McpEndpointStatus>("mcp_endpoint_status");
}

/** Binds the listener again on the current port. A failure is in the status, not thrown. */
export async function restartMcpEndpoint(): Promise<McpEndpointStatus> {
  return invoke<McpEndpointStatus>("restart_mcp_endpoint");
}

/** Saves `port` as the MCP port and moves the listener onto it. */
export async function setMcpPort(port: number): Promise<McpEndpointStatus> {
  return invoke<McpEndpointStatus>("set_mcp_port", { port });
}
