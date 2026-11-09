import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "./gesture";
import { listenHere, unsubscribed } from "./board";
import type { McpNodeKey } from "./mcp-access";

/**
 * The **Agents**: sessions of AI clients that attached with a PIN, the Claim each holds (a subtree
 * that is its whole view), and the accounts whose usage decides when they are at capacity (see
 * docs/spec/mcp-server.md and ADR 0018). The shapes mirror `crates/arlesh-core/src/agents/model.rs`.
 */

/** Whether a Claim is held or set aside. */
export type ClaimStatus = "active" | "paused";

/** A subtree an agent holds. */
export interface Claim {
  root: McpNodeKey;
  status: ClaimStatus;
  claimed_at: string;
}

/** One agent. */
export interface Agent {
  id: number;
  name: string;
  account: string;
  session_uuid: string;
  claim: Claim | null;
  locked: boolean;
  created_at: string;
  last_seen_at: string | null;
}

/** Where an agent's Claim stands among the others. */
export type AgentStanding = "unclaimed" | "active" | "paused" | "shadowed" | "unreachable";

/** Why an agent's Agentic Tasks read blocked. */
export type CapacityCause =
  | { kind: "agent_locked" }
  | { kind: "account_locked" }
  | { kind: "usage_limit"; window: string; resets_at: string };

/** One agent as the page lists it. */
export interface AgentSummary {
  agent: Agent;
  standing: AgentStanding;
  at_capacity: CapacityCause | null;
}

/** One limit window of an account, as an agent last reported it. */
export interface UsageWindow {
  kind: string;
  percent_used: number;
  resets_at: string;
}

/** An account the agents work under. */
export interface Account {
  label: string;
  locked: boolean;
  windows: UsageWindow[];
}

/** Every agent and account. */
export interface AgentsOverview {
  agents: AgentSummary[];
  accounts: Account[];
}

/** A one-time PIN to give an agent. */
export interface IssuedPin {
  pin: string;
  expires_at: string;
}

/** A change the user makes to an agent by hand. */
export type AgentAction =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "release" }
  | { action: "lock"; locked: boolean }
  | { action: "remove" };

/** The backend's event name for any change to the agents. */
const AGENTS_CHANGED = "agents-changed";

/** Every agent and account. */
export async function fetchAgents(): Promise<AgentsOverview> {
  return invoke<AgentsOverview>("list_agents");
}

/** Asks for a PIN to give an agent. */
export async function issueAgentPin(): Promise<IssuedPin> {
  return invoke<IssuedPin>("issue_agent_pin");
}

/** Pauses, resumes, releases, locks or removes one agent. */
export async function applyAgentAction(id: number, action: AgentAction): Promise<void> {
  return invoke<void>("apply_agent_action", { id, action });
}

/** Locks or unlocks a whole account by hand. */
export async function setAgentAccountLocked(label: string, locked: boolean): Promise<void> {
  return invoke<void>("set_agent_account_locked", { label, locked });
}

/** Calls `onChange` each time the agents change. A webview with no Tauri host hears nothing. */
export async function onAgentsChanged(onChange: () => void): Promise<UnlistenFn> {
  return listenHere<unknown>(AGENTS_CHANGED, () => onChange()).catch(() => unsubscribed);
}
