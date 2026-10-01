import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "./gesture";
import { listenHere, unsubscribed } from "./board";

/**
 * The **agent capacity lock**: one app-wide on/off state meaning "agents are at capacity" (see
 * docs/spec/mcp-server.md, "Agent capacity").
 *
 * It lives in the backend, shared by every window and the MCP endpoint, where an agent sets and
 * clears it too; the backend tells every window each time it changes, whoever changed it.
 */

/** The lock as the backend answers it. */
export interface AgentCapacityState {
  /** Whether agents are at capacity. */
  at_capacity: boolean;
}

/** The backend's event name. Must match `AGENT_CAPACITY_CHANGED` in `src-tauri/src/commands/capacity.rs`. */
const AGENT_CAPACITY_CHANGED = "agent-capacity-changed";

/** The lock as it stands. */
export async function fetchAgentCapacity(): Promise<AgentCapacityState> {
  return invoke<AgentCapacityState>("agent_capacity");
}

/** Sets the lock on or off; answers with the state it left. */
export async function setAgentCapacity(atCapacity: boolean): Promise<AgentCapacityState> {
  return invoke<AgentCapacityState>("set_agent_capacity", { atCapacity });
}

function isAgentCapacityState(value: unknown): value is AgentCapacityState {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "at_capacity") === "boolean";
}

/**
 * Calls `onChange` with the lock's new state each time it changes — from this window, another, or
 * an agent over the MCP. A payload that does not parse is dropped. A webview with no Tauri host
 * hears nothing, and resolves to a no-op rather than rejecting.
 */
export async function onAgentCapacityChanged(
  onChange: (state: AgentCapacityState) => void,
): Promise<UnlistenFn> {
  return listenHere<unknown>(AGENT_CAPACITY_CHANGED, (event) => {
    if (isAgentCapacityState(event.payload)) onChange(event.payload);
  }).catch(() => unsubscribed);
}
