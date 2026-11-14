import { invokeOutsideGesture } from "./gesture";

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
