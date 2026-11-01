import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "./gesture";
import { listenHere, unsubscribed } from "./board";

/**
 * The mode the app runs in on this device — **Standalone** (the local database) or **Client** (an
 * `arlesh-server`) — and, in Client mode, how the server is doing. See docs/spec/client-mode.md.
 */

/** Why the board is read-only, when it is. */
export type ReadOnlyReason = "server_unreachable" | "update_app" | "update_server";

/** The server, as the backend last found it. */
export interface ServerStatus {
  url: string;
  reachable: boolean;
  /** When the board was last loaded from the server: a local date-time, or `null`. */
  last_sync: string | null;
  read_only: ReadOnlyReason | null;
  server_api_version: number | null;
}

export type AppMode = "standalone" | "client";

/** What the backend says about the mode. */
export interface ModeStatus {
  mode: AppMode;
  /** Whether to ask the first-run question. */
  first_run: boolean;
  server: ServerStatus | null;
  /** The API version this app speaks. */
  api_version: number;
  /** Whether this build can run Standalone. */
  standalone_available: boolean;
}

/** What `/health` answered. */
export interface Health {
  api_version: number;
  version: string;
  commit: string;
}

/** What testing a server found. */
export interface ServerCheck {
  health: Health;
  /** Why this app could not write to it, or `null` when it could. */
  read_only: ReadOnlyReason | null;
}

/** The backend's event name. Must match `SERVER_STATUS_CHANGED` in `src-tauri/src/commands/client_mode.rs`. */
const SERVER_STATUS_CHANGED = "server-status-changed";

export async function fetchModeStatus(): Promise<ModeStatus> {
  return invoke<ModeStatus>("mode_status");
}

export async function keychainAvailable(): Promise<boolean> {
  return invoke<boolean>("keychain_available");
}

/** Checks a server without switching to it. */
export async function testServer(url: string, token: string): Promise<ServerCheck> {
  return invoke<ServerCheck>("test_server", { url, token });
}

/** Switches this device to the server and restarts the app. */
export async function connectToServer(url: string, token: string, tokenInFile: boolean): Promise<void> {
  await invoke<null>("connect_to_server", { url, token, tokenInFile });
}

/** Runs this device Standalone; restarts the app when it was a Client. */
export async function runStandalone(): Promise<void> {
  await invoke<null>("use_standalone");
}

function isServerStatus(value: unknown): value is ServerStatus {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "url") === "string" && typeof Reflect.get(value, "reachable") === "boolean";
}

/** Calls `onChange` each time the server's status changes. */
export async function onServerStatusChanged(onChange: (status: ServerStatus) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(SERVER_STATUS_CHANGED, (event) => {
    if (isServerStatus(event.payload)) onChange(event.payload);
  }).catch(() => unsubscribed);
}
