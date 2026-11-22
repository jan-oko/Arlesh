import { invokeOutsideGesture } from "./gesture";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listenHere, unsubscribed } from "@/api/board";

/** The events a notification can tell of; ids match the phone's channels (docs/spec/notifications.md). */
export type NotificationChannel =
  | "agent_question"
  | "task_overdue"
  | "task_generated"
  | "capacity_locked"
  | "capacity_cleared";

/** One desktop notification switch. */
export interface NotificationSwitch {
  channel: NotificationChannel;
  enabled: boolean;
}

const CHANNELS: readonly string[] = [
  "agent_question",
  "task_overdue",
  "task_generated",
  "capacity_locked",
  "capacity_cleared",
];

function isChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string" && CHANNELS.includes(value);
}

function isSwitch(value: unknown): value is NotificationSwitch {
  if (typeof value !== "object" || value === null) return false;
  return isChannel(Reflect.get(value, "channel")) && typeof Reflect.get(value, "enabled") === "boolean";
}

/** Every event and whether this device shows it; empty where the app has no desktop notifications. */
export async function notificationSwitches(): Promise<NotificationSwitch[]> {
  const switches = await invokeOutsideGesture<unknown>("notification_switches");
  return Array.isArray(switches) ? switches.filter(isSwitch) : [];
}

/** Switches one event on or off for this device. */
export async function setNotificationEnabled(channel: NotificationChannel, enabled: boolean): Promise<void> {
  await invokeOutsideGesture<null>("set_notification_enabled", { channel, enabled });
}

/** The event the shell raises when the user clicks a desktop notification of an agent's question. */
const OPEN_REVIEW = "arlesh-open-review";

/**
 * Calls `onOpen` with the board key of the Task a clicked notification is about, and the open wait
 * it names, each time the shell says one was clicked (Linux only; see docs/spec/notifications.md).
 * A payload with no Task is dropped.
 */
export async function onOpenReview(onOpen: (question: { task: string; wait: string | null }) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(OPEN_REVIEW, (event) => {
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null) return;
    const task: unknown = Reflect.get(payload, "task");
    const wait: unknown = Reflect.get(payload, "wait");
    if (typeof task === "string") onOpen({ task, wait: typeof wait === "string" && wait !== "" ? wait : null });
  }).catch(() => unsubscribed);
}
