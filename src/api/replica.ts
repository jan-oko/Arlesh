import type { UnlistenFn } from "@tauri-apps/api/event";
import { invokeOutsideGesture } from "@/api/gesture";
import { listenHere, unsubscribed } from "@/api/board";

/**
 * The Client's Replica (docs/spec/client-mode.md): the backend keeps the whole board in memory,
 * makes every write there first and sends it to the server afterwards. What the window hears about
 * that is here.
 */

/** The backend's event name. Must match `REPLICA_DROPPED` in the Tauri command module. */
const REPLICA_DROPPED = "replica-dropped";

/**
 * Why changes were taken back: the server refused them, it could not be reached to send them, it
 * answered a write otherwise than the Replica had shown, or the app went to the background first.
 */
export type ReplicaDropReason = "refused" | "unreachable" | "differed" | "suspended";

/** Changes the Replica made locally and then had to take back. */
export interface ReplicaDropped {
  /** Changes taken back and not made. */
  count: number;
  /** Of the changes on their way when the connection was lost, how many the server may have saved. */
  maybe_saved: number;
  reason: ReplicaDropReason;
}

/** Whether `value` is a {@link ReplicaDropped}, as the backend sends it. */
export function isReplicaDropped(value: unknown): value is ReplicaDropped {
  if (typeof value !== "object" || value === null) return false;
  const reason: unknown = Reflect.get(value, "reason");
  return (
    typeof Reflect.get(value, "count") === "number" &&
    typeof Reflect.get(value, "maybe_saved") === "number" &&
    (reason === "refused" || reason === "unreachable" || reason === "differed" || reason === "suspended")
  );
}

/**
 * Calls `handler` with every `replica-dropped` event. Resolves to the unsubscribe, which is a no-op
 * in a webview with no Tauri host. An event whose payload is not a {@link ReplicaDropped} is ignored.
 */
export async function listenReplicaDropped(handler: (dropped: ReplicaDropped) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(REPLICA_DROPPED, (event) => {
    if (isReplicaDropped(event.payload)) handler(event.payload);
  }).catch(() => unsubscribed);
}

/**
 * Tells the backend how long this window took, from receiving the `board-changed` event numbered
 * `seq` to holding the board it brings: the part of a press's latency the backend cannot see.
 * Fire and forget: it never throws and nobody waits for it.
 */
export function reportPressTiming(seq: number, ipcApplyMs: number): void {
  try {
    invokeOutsideGesture("report_press_timing", { seq, ipcApplyMs }).catch(() => undefined);
  } catch {
    // Timing is best-effort.
  }
}
