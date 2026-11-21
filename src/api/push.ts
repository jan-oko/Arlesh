import { invoke } from "./gesture";

/**
 * Phone push notifications: the Android activity's bridge (`PushBridge.kt`, injected as
 * `ArleshPush`) and the server's push routes. See docs/spec/notifications.md.
 */

/** What the activity offers the page. */
export interface PushBridge {
  /** Whether this build has a Firebase configuration. */
  available: () => boolean;
  /** Whether the app may post notifications now. */
  allowed: () => boolean;
  requestPermission: () => void;
  /** Reads the FCM token; it arrives as an `arlesh-push-token` window event. */
  fetchToken: () => void;
  /** Opens the system's notification settings for this app. */
  openSettings: () => void;
  /**
   * What a tapped notification asked to open, once, as JSON `{"task": "task-12", "channel":
   * "agent_question"}`; empty when none. See {@link readOpenedNotification}.
   */
  takeOpenedNotification: () => string;
}

/** Fired on `window` with the FCM token as `detail`. */
export const PUSH_TOKEN_EVENT = "arlesh-push-token";
/** Fired on `window` when a tapped notification asks to open something; ask the bridge what. */
export const OPEN_TASK_EVENT = "arlesh-open-task";

function isBridge(value: unknown): value is PushBridge {
  if (typeof value !== "object" || value === null) return false;
  return ["available", "allowed", "requestPermission", "fetchToken", "openSettings", "takeOpenedNotification"].every(
    (name) => typeof Reflect.get(value, name) === "function",
  );
}

/** A tapped notification: the Task it is about, if it is about one, and the channel it came on. */
export interface OpenedNotification {
  task: string | null;
  channel: string;
}

/** What the bridge holds of a tapped notification, taken once; `null` when there is none. */
export function readOpenedNotification(bridge: PushBridge): OpenedNotification | null {
  const raw = bridge.takeOpenedNotification();
  if (raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const task: unknown = Reflect.get(parsed, "task");
    const channel: unknown = Reflect.get(parsed, "channel");
    return { task: typeof task === "string" && task !== "" ? task : null, channel: typeof channel === "string" ? channel : "" };
  } catch {
    return null;
  }
}

/** The activity's push bridge, or `null` where there is none: the desktop, a browser, a test. */
export function pushBridge(): PushBridge | null {
  const bridge: unknown = Reflect.get(window, "ArleshPush");
  return isBridge(bridge) ? bridge : null;
}

/** Whether the server can push, and from which Firebase project. */
export interface PushState {
  enabled: boolean;
  project_id: string | null;
}

export async function pushState(): Promise<PushState> {
  return invoke<PushState>("push_state");
}

/** Registers this device's FCM token with the server. */
export async function registerPush(fcmToken: string): Promise<{ new: boolean }> {
  return invoke<{ new: boolean }>("register_push", { fcmToken });
}

export async function unregisterPush(): Promise<void> {
  await invoke<null>("unregister_push");
}
