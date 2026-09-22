import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

/**
 * The frontend half of the Gesture protocol (ADR 0006), and the single door every Tauri command
 * goes through.
 *
 * A Gesture is the unit Ctrl+Z reverses. The backend journals every write from a SQL trigger, but
 * a write made with no Gesture open is journaled with no Gesture id and is never offered as an undo
 * step — so something has to say where one thing the user did begins and ends, and only the
 * frontend knows that a paste of five nodes is five commands and one press.
 *
 * Two layers do that here:
 *
 * - {@link invoke} opens a Gesture around **every** command. That is what makes a lone command its
 *   own undo step without anyone remembering to ask for it — the same argument ADR 0006 makes for
 *   journaling from triggers rather than per command.
 * - {@link withGesture} opens one explicit Gesture around a run of commands that belong together,
 *   and names it. Opens nest and join, so the inner per-command opens fold into it and the whole
 *   run is one step.
 *
 * Everything is best-effort in one direction only: if the protocol itself fails, the user's command
 * still runs and simply is not undoable. Undo bookkeeping never blocks a write.
 */

const LOG_PREFIX = "[arlesh]";

/** What one Gesture on a stack amounts to. Counts and table names — the phrasing is ours. */
export interface GestureSummary {
  /** Which Gesture is being described. */
  gesture: string;
  /** How many rows it changed in total. */
  rows: number;
  /** How many rows it created. */
  inserted: number;
  /** How many rows it rewrote. */
  updated: number;
  /** How many rows it removed. */
  deleted: number;
  /** The tables it touched, in name order and without repetition. */
  tables: string[];
}

/** Whether there is anything to undo or redo, and what each one is. For labelling a control. */
export interface UndoStatus {
  undo: GestureSummary | null;
  redo: GestureSummary | null;
}

/**
 * Human names for Gestures, keyed by id.
 *
 * The backend deliberately has nowhere to put one: a Gesture id is minted by the database and the
 * summary carries counts, not a sentence. The name is set here when the Gesture opens and read back
 * when an undo returns that id, which is the only way "paste 5 nodes" can reach the toast.
 */
const gestureNames = new Map<string, string>();

/** How many names to keep. Comfortably past the backend's stack depth; the rest are unreachable. */
const MAX_REMEMBERED_NAMES = 200;

function isGestureId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Opens a Gesture, or joins the one already open, and returns its id — or `null` when the backend
 * could not open one, in which case the caller runs without one and its writes are not undoable.
 */
async function openGesture(): Promise<string | null> {
  try {
    const gesture = await tauriInvoke<unknown>("open_gesture");
    if (isGestureId(gesture)) return gesture;
    console.warn(`${LOG_PREFIX} open_gesture returned no id; this run will not be undoable`);
    return null;
  } catch (error: unknown) {
    console.warn(`${LOG_PREFIX} open_gesture failed; this run will not be undoable:`, error);
    return null;
  }
}

/**
 * Closes one open, swallowing a failure so it can never mask the error the caller was already
 * propagating — a Gesture that will not close is a bookkeeping problem, not the user's.
 */
async function closeGesture(): Promise<void> {
  try {
    await tauriInvoke("close_gesture");
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} close_gesture failed:`, error);
  }
}

/**
 * Closes one open and takes back everything the Gesture wrote, swallowing a failure for the same
 * reason {@link closeGesture} does: the caller is already propagating the error the user needs to
 * see, and a second one about undo bookkeeping would only displace it.
 */
async function abortGesture(): Promise<void> {
  try {
    await tauriInvoke("abort_gesture");
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} abort_gesture failed; the failed run's writes stand:`, error);
  }
}

/** Names a Gesture, unless a wider one already claimed it — the outermost name is the true one. */
function rememberName(gesture: string, name: string): void {
  if (gestureNames.has(gesture)) return;
  if (gestureNames.size >= MAX_REMEMBERED_NAMES) {
    const oldest = gestureNames.keys().next();
    if (oldest.done !== true) gestureNames.delete(oldest.value);
  }
  gestureNames.set(gesture, name);
}

/** The name the frontend gave a Gesture when it opened it, or `undefined` if nobody named it. */
export function gestureName(gesture: string): string | undefined {
  return gestureNames.get(gesture);
}

/**
 * Invokes a Tauri command inside a Gesture: the app's only call into the backend.
 *
 * Drop-in for `@tauri-apps/api/core`'s `invoke` — same name, same arguments — so that every file in
 * `src/api/` reaches the backend through one door. Outside a {@link withGesture} the command is its
 * own Gesture and its own undo step; inside one it joins that Gesture.
 *
 * The Gesture is closed whether the command resolves or rejects. A command that throws having
 * already written something must still be a step the user can reverse.
 */
export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  const gesture = await openGesture();
  try {
    // Forwarded with the same arity it arrived with: `invoke("list_tasks")` and
    // `invoke("list_tasks", undefined)` are not the same call to anyone watching.
    return args === undefined ? await tauriInvoke<T>(command) : await tauriInvoke<T>(command, args);
  } finally {
    if (gesture !== null) await closeGesture();
  }
}

/**
 * Runs `run` as one Gesture called `name`, so everything it invokes is a single Ctrl+Z.
 *
 * `name` is what the toast will say the user did ("paste 5 nodes"), so it is phrased from the
 * user's side rather than from the rows that moved.
 *
 * The Gesture closes even when `run` throws, and `run`'s error propagates unchanged: a paste that
 * fails halfway through is still one thing that happened and still one thing to undo.
 */
export async function withGesture<T>(name: string, run: () => Promise<T>): Promise<T> {
  const gesture = await openGesture();
  if (gesture !== null) rememberName(gesture, name);
  try {
    return await run();
  } finally {
    if (gesture !== null) await closeGesture();
  }
}

/**
 * Runs `run` as one **all-or-nothing** Gesture called `name`: one Ctrl+Z when it succeeds, and
 * nothing written at all when it does not.
 *
 * The difference from {@link withGesture} is what a failure halfway through means. A paste that
 * gets five nodes in and is refused the sixth has done five things the user can see, and closing
 * the Gesture — making them one Ctrl+Z — is the right answer. An editor's Save is not like that:
 * the fields are one thing the user filled in, so a save that writes the title, the tags and then
 * fails on a dependency has left a state nobody asked for. So the Gesture is *aborted*, and the
 * backend takes its writes back in one transaction.
 *
 * `run`'s error propagates unchanged, and the caller is expected to say what failed — the writes
 * are gone, so a silent failure would leave the user looking at a board that did not change with
 * no reason given.
 */
export async function withAtomicGesture<T>(name: string, run: () => Promise<T>): Promise<T> {
  const gesture = await openGesture();
  if (gesture !== null) rememberName(gesture, name);
  let failed = false;
  try {
    return await run();
  } catch (error: unknown) {
    failed = true;
    throw error;
  } finally {
    if (gesture !== null) {
      if (failed) await abortGesture();
      else await closeGesture();
    }
  }
}

/**
 * Reverses the most recent Gesture and returns what it reversed.
 *
 * `null` means the stack was empty — nothing happened, and that is not an error. A rejection means
 * the Gesture could not be applied, the board is untouched, and it is still on the stack.
 */
export async function undo(): Promise<GestureSummary | null> {
  return tauriInvoke<GestureSummary | null>("undo");
}

/** Reapplies the most recently undone Gesture. `null` and a rejection mean what they do for {@link undo}. */
export async function redo(): Promise<GestureSummary | null> {
  return tauriInvoke<GestureSummary | null>("redo");
}

/** What the next undo and redo would be. For labelling and disabling a control, never as a guard. */
export async function undoStatus(): Promise<UndoStatus> {
  return tauriInvoke<UndoStatus>("undo_status");
}
