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
  /** The board key of the Task a tapped notification asked to open, once; empty when none. */
  takeOpenedTask: () => string;
}

/** Fired on `window` with the FCM token as `detail`. */
export const PUSH_TOKEN_EVENT = "arlesh-push-token";
/** Fired on `window` when a tapped notification asks to open a Task; ask the bridge which. */
export const OPEN_TASK_EVENT = "arlesh-open-task";

function isBridge(value: unknown): value is PushBridge {
  if (typeof value !== "object" || value === null) return false;
  return ["available", "allowed", "requestPermission", "fetchToken", "openSettings", "takeOpenedTask"].every(
    (name) => typeof Reflect.get(value, name) === "function",
  );
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
