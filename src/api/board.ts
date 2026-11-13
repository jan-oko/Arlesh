import { invokeOutsideGesture } from "@/api/gesture";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { currentWindowLabel } from "@/api/window-label";
import type { PersistedTab } from "@/stores/tab-persistence";
import { parsePersistedTab } from "@/stores/tab-persistence";
import type { BoardChanges } from "@/utils/board-changes";

/**
 * The three things windows say to each other.
 *
 * **The board changed** — sent by the backend to every window, the one that made the change
 * included, as **the changed nodes**: the entries of the board that differ, with the sequence
 * number, the revision and the epoch they bring the board to and the board's hash (ADR 0020). The
 * window applies them to the board it holds (`src/utils/board-changes.ts`) and no longer reloads
 * after its own write. In Client mode the server's change stream is relayed as it is; in Standalone
 * the backend's own publisher makes the same event. See `src-tauri/src/commands/board.rs`.
 *
 * **A tab arrived** — emitted by a window that is handing one of its tabs to another. This one
 * does carry a payload, because a tab is state rather than a signal; it is the same shape the tab
 * is persisted in, so a tab that moves and a tab that is restored are read by one parser.
 *
 * **Hand me that tab** — emitted by a window a tab was dragged onto, to the window the tab came
 * from. The drag told the receiving window which tab it is and where it lives, but only the window
 * that holds a tab has its state, so the receiver asks and the holder sends it the way the menu's
 * move does. See `utils/tab-drag`.
 *
 * All three are wrapped here rather than called from a hook, so `@tauri-apps/api/event` has one door
 * the way `invoke` has one in `src/api/gesture.ts`. Another domain's event (the agents' change,
 * `src/api/agents.ts`) comes through the same door, {@link listenHere}.
 */

/** The backend's event name. Must match `BOARD_CHANGED` in `crates/arlesh-core/src/board.rs`. */
const BOARD_CHANGED = "board-changed";

/** The event a window sends when it hands a tab to another window. */
const TAB_MOVED = "tab-moved";

/** The event a window sends to ask another for a tab that was dragged onto it. */
const TAB_CLAIMED = "tab-claimed";

/** A request for a tab: which one, and the window that should receive it. */
export interface TabClaim {
  tabId: string;
  into: string;
}

/**
 * A point in the server's history of the board: how many writes it had committed, in one run of
 * the server (the epoch). Client mode only: Standalone has no server and stamps nothing.
 * The window's board carries the one it holds (`src/stores/use-board-store.ts`), and a writer
 * waits for it to reach the revision of its write.
 */
export interface BoardRevision {
  epoch: string;
  revision: number;
}

/** Whether `value` is a {@link BoardRevision}, as the backend sends it. */
export function isBoardRevision(value: unknown): value is BoardRevision {
  if (typeof value !== "object" || value === null) return false;
  const epoch: unknown = Reflect.get(value, "epoch");
  const revision: unknown = Reflect.get(value, "revision");
  return typeof epoch === "string" && typeof revision === "number";
}

/**
 * One `board-changed` event: the publication it brings the board to and what changed.
 *
 * `seq` is the publication's number within its `epoch`, and `revision` the writes the board holds
 * at least. An event with no `seq` comes from a server that predates changed nodes, and one that
 * says `reload` could not carry its changes: either way the window loads the whole board.
 */
export interface BoardChange {
  epoch: string;
  seq?: number;
  revision: number;
  /** The instant the board was derived at: what "now" means on it. */
  now?: string;
  /** The board hash after the event. */
  hash?: number;
  changes?: BoardChanges;
  reload?: boolean;
}

/** Whether `value` is a {@link BoardChange}, as the backend sends it. */
export function isBoardChange(value: unknown): value is BoardChange {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "epoch") === "string" && typeof Reflect.get(value, "revision") === "number";
}

/** The latest publication's identity: what a window checks its board against. */
export interface BoardHead {
  epoch: string;
  seq: number;
  revision: number;
  hash: number;
  /** The hash of each collection, for naming the one that differs. */
  sums: Record<string, number>;
}

function isBoardHead(value: unknown): value is BoardHead {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "epoch") === "string" &&
    typeof Reflect.get(value, "seq") === "number" &&
    typeof Reflect.get(value, "hash") === "number"
  );
}

/**
 * The newest revision a write is known to have reached: what a window settles on after its own
 * write. In Client mode the highest revision any answer of the server's current run carried; in
 * Standalone the publisher's. `null` when none is known, or the call failed.
 */
export async function boardFence(): Promise<BoardRevision | null> {
  try {
    const fence = await invokeOutsideGesture<unknown>("board_fence");
    return isBoardRevision(fence) ? fence : null;
  } catch {
    return null;
  }
}

/** The latest publication's identity, or `null` when the backend has none yet or the call failed. */
export async function boardHead(): Promise<BoardHead | null> {
  try {
    const head = await invokeOutsideGesture<unknown>("board_head");
    return isBoardHead(head) ? head : null;
  } catch {
    return null;
  }
}

/** What a window found when its board disagreed with the producer's. */
export interface DivergenceReport {
  /** How it was found: `event`, `head`, `recompute` or `load`. */
  found_by: "event" | "head" | "recompute" | "load";
  epoch: string;
  window_seq: number | null;
  head_seq: number | null;
  window_hash: number;
  head_hash: number;
  /** The collections whose sums differ. */
  collections: string[];
}

/** Writes a board divergence, a bug, to the app's log. Never throws: the window reloads anyway. */
export async function reportBoardDivergence(report: DivergenceReport): Promise<void> {
  console.error("[arlesh] board divergence", report);
  try {
    await invokeOutsideGesture("report_board_divergence", { report });
  } catch {
    // The report is best-effort; the console line above is the window's own record.
  }
}

/** Unsubscribes nothing, for a webview with no event bus — a unit test's jsdom. */
export function unsubscribed(): void {}

/**
 * Listens for `event` sent to **this window**, and only to it.
 *
 * Tauri's `listen` with no target listens to every target: its backend delivers an event to a
 * listener registered for "any" target whatever the emit was addressed to (`match_any_or_filter`
 * in tauri's `event/listener.rs`). So an `emitTo` one window meant for another reached **every**
 * window listening — a tab handed to one window was adopted by all of them. Naming this window's
 * label as the target is what makes `emitTo` mean "to that window". (A board change is emitted to
 * every window, so it reaches each one once either way.)
 */
export function listenHere<T>(event: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return listen<T>(event, handler, { target: currentWindowLabel() });
}

/**
 * Calls `onChanged` with every `board-changed` event, or with `null` for one whose payload is not a
 * {@link BoardChange} (which a window answers by loading the board whole).
 *
 * Resolves to the unsubscribe. A webview with no Tauri host hears nothing and says so by resolving
 * to a no-op rather than rejecting: a view that cannot be told about other windows still works,
 * and there are no other windows to be told about.
 */
export async function onBoardChanged(onChanged: (change: BoardChange | null) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(BOARD_CHANGED, (event) => {
    onChanged(isBoardChange(event.payload) ? event.payload : null);
  }).catch(() => unsubscribed);
}

/** Hands `tab` to the window labelled `label`. */
export async function sendTabToWindow(label: string, tab: PersistedTab): Promise<void> {
  await emitTo(label, TAB_MOVED, tab);
}

/**
 * Calls `onTab` with each tab another window hands this one.
 *
 * A payload that does not parse is dropped rather than half-adopted: a tab is only worth opening
 * if it is the tab that was sent, and the alternative is a window gaining an empty strip entry
 * that nothing can explain.
 */
export async function onTabMoved(onTab: (tab: PersistedTab) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(TAB_MOVED, (event) => {
    const tab = parsePersistedTab(event.payload);
    if (tab !== null) onTab(tab);
  }).catch(() => unsubscribed);
}

/** Asks the window labelled `from` to hand its tab `claim.tabId` to `claim.into`. */
export async function claimTab(from: string, claim: TabClaim): Promise<void> {
  await emitTo(from, TAB_CLAIMED, claim);
}

function isTabClaim(value: unknown): value is TabClaim {
  if (typeof value !== "object" || value === null) return false;
  const tabId: unknown = Reflect.get(value, "tabId");
  const into: unknown = Reflect.get(value, "into");
  return typeof tabId === "string" && typeof into === "string";
}

/** Calls `onClaim` with each request another window makes for one of this window's tabs. */
export async function onTabClaimed(onClaim: (claim: TabClaim) => void): Promise<UnlistenFn> {
  return listenHere<unknown>(TAB_CLAIMED, (event) => {
    if (isTabClaim(event.payload)) onClaim(event.payload);
  }).catch(() => unsubscribed);
}
