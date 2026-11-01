import { create } from "zustand";
import { getErrorMessage, isWireError } from "@/api/errors";
import type { RowId } from "@/api/node-id";
import {
  cancelTail as cancelTailOf,
  enqueue as enqueueIn,
  flush,
  forgetReflected,
  isDrained,
  markAnswered,
  markSending,
  nextToSend,
  refuse,
  resolveTemporary,
} from "@/utils/pending-writes";
import type { BoardStamp, Lane, NodePatch, OwnFields, PendingWrite, Removal } from "@/utils/pending-writes";

/** Turns a node id a write names into the real one, at the moment the write is sent. */
export type IdResolver = (id: string) => string;

/** What a write's response said, as far as it said anything (Task 9298; `null` where it did not). */
export interface WriteResponse {
  epoch: string | null;
  revision: number | null;
  /** The node's own fields as the server wrote them, when the response carries the row. */
  fields: OwnFields | null;
  /** A create's real node id. */
  createdId: string | null;
  /** A create's database row, so a write queued behind it can name the row (decision 8). */
  createdRowId?: RowId;
}

/** How a send ended without throwing: the server wrote it, or a gesture refused it. */
export type WriteResult =
  | { outcome: "written"; response: WriteResponse }
  | { outcome: "refused"; message: string };

/** An anchored notice, as the app's toast takes it. */
export interface WriteToast {
  nodeId: string;
  message: string;
}

/** One action as the hook that made it hands it to the lane. */
export interface WriteSpec {
  /** The node it touches, by node id (a temporary one for a node still to be created). */
  nodeId: string;
  patch: NodePatch;
  /** What the user would call it, for the undo notice. */
  label: string;
  /** Sends it. Every node id it names is passed through `resolve` first. It rejects with the core's
   * error, or returns `refused` for a gesture the backend declined. */
  send: (resolve: IdResolver) => Promise<WriteResult>;
  /** Shows the one toast a refusal or a flush gets. */
  showToast: (toast: WriteToast) => void;
  /** The one toast for a server that cannot be reached. */
  unreachableMessage: string;
  /** Called when the backend holds the write for a confirmation: it was rolled back without a toast. */
  onConfirmation?: () => void;
  /** Words the toast a refusal gets around the backend's reason. Without it, the reason is the toast. */
  refusalToast?: (reason: string) => string;
  /** Called when the write is taken back unsent or refused, with the reason: an editor Save uses it
   * to reopen the editor on what the user typed (decision 14). Not called for a confirmation. */
  onRolledBack?: (reason: string) => void;
}

/** What `cancelTail` took back. */
export interface CancelledWrite {
  label: string;
}

/** Told when a create is answered: the temporary id and the real node id it became. */
export type ResolvedListener = (temporaryId: string, realId: string) => void;

/** Told when creates leave the board unanswered (refused, flushed or cancelled), by temporary id. */
export type RemovedListener = (removed: ReadonlyArray<{ id: string; parentId: string }>) => void;

/** How a send that threw is handled (ADR 0012, decision 7). */
type Failure = "unreachable" | "confirmation" | "refusal";

function classify(error: unknown): Failure {
  if (!isWireError(error)) return "refusal";
  if (error.kind === "needs_confirmation") return "confirmation";
  const details: unknown = error.details;
  const reason: unknown = typeof details === "object" && details !== null ? Reflect.get(details, "reason") : undefined;
  return error.kind === "not_permitted" && reason === "server_unreachable" ? "unreachable" : "refusal";
}

interface PendingWritesStore {
  /** The window's pending writes, oldest first. */
  writes: Lane;
  /** Temporary node id to real node id, for the life of the window (decision 8). */
  aliases: ReadonlyMap<string, string>;
  /** The window's board-read counter: bumped at the start of every board read (decision 5). */
  reads: number;
  /** How many writes have been rolled back, so undo can tell that the write it waited for was. */
  rollbacks: number;
  /** Adds an action to the lane and sends it in its turn. Returns its place in the lane. */
  enqueue: (spec: WriteSpec) => number;
  /** A fresh temporary node id, `tmp:<n>`. */
  nextTemporaryId: () => string;
  /** The real id behind `id`, or `id` itself. */
  resolveId: IdResolver;
  /** Real node id to the temporary id it was created under, so a view keeps one React key. */
  origins: ReadonlyMap<string, string>;
  /** The database row a created node was answered with, by real node id. */
  rowIdFor: (nodeId: string) => RowId | undefined;
  /** Calls `listener` when a create is answered, in the same tick as the lane changes. */
  subscribeResolved: (listener: ResolvedListener) => () => void;
  /** Calls `listener` when creates are taken off the board without being answered. */
  subscribeRemoved: (listener: RemovedListener) => () => void;
  /** Whether a write is queued or in flight. */
  isBusy: () => boolean;
  /** Resolves once no write is queued or in flight. Immediately when none is. */
  whenDrained: () => Promise<void>;
  /** Cancels the newest write when it has not been sent; `null` when it cannot be. */
  cancelTail: () => CancelledWrite | null;
  /** A board read is about to begin: returns its number. */
  beginRead: () => number;
  /** A board drawn at `stamp` is on screen. */
  reportBoard: (boardId: string, stamp: BoardStamp) => void;
  /** That board is gone. */
  forgetBoard: (boardId: string) => void;
  /** Empties everything. For a test, and a window that starts over. */
  reset: () => void;
}

export const usePendingWritesStore = create<PendingWritesStore>()((set, get) => {
  // The send closures sit beside the list, keyed by seq, and never inside it (decision 2).
  const entries = new Map<number, WriteSpec>();
  const boards = new Map<string, BoardStamp>();
  const waiters: Array<() => void> = [];
  const rows = new Map<string, RowId>();
  const resolvedListeners = new Set<ResolvedListener>();
  const removedListeners = new Set<RemovedListener>();
  let nextSeq = 1;
  let nextTemp = 1;

  const resolveId: IdResolver = (id) => get().aliases.get(id) ?? id;

  /** Puts `lane` in place, forgetting what every reported board has caught up with. */
  const setLane = (lane: Lane, more: Partial<Pick<PendingWritesStore, "aliases" | "origins" | "rollbacks">> = {}): void => {
    set({ writes: forgetReflected(lane, [...boards.values()]), ...more });
  };

  const release = (removal: Removal): void => {
    for (const write of removal.removed) entries.delete(write.seq);
    announceRemoved(removal.removed);
  };

  /** Tells the views which placeholders just left the board, so their selection and editor move on. */
  const announceRemoved = (removed: readonly PendingWrite[]): void => {
    const gone = removed.flatMap((write) =>
      write.patch.kind === "create" ? [{ id: write.patch.node.id, parentId: write.patch.parentId }] : [],
    );
    if (gone.length > 0) removedListeners.forEach((listener) => listener(gone));
  };

  /** Sends the next write if the lane is free to, and lets a waiter go when it has emptied. */
  const pump = (): void => {
    const lane = get().writes;
    const next = nextToSend(lane);
    if (next === undefined) {
      if (isDrained(lane)) waiters.splice(0).forEach((wake) => wake());
      return;
    }
    set({ writes: markSending(lane, next.seq) });
    void run(next);
  };

  const run = async (write: PendingWrite): Promise<void> => {
    const entry = entries.get(write.seq);
    if (entry === undefined) return;
    let result: WriteResult;
    try {
      result = await entry.send(resolveId);
    } catch (error: unknown) {
      if (!isInFlight(write.seq)) return;
      const failure = classify(error);
      if (failure === "unreachable") rollBackEverything(write, entry);
      else if (failure === "confirmation") rollBackFrom(write, entry, null, entry.onConfirmation);
      else rollBackFrom(write, entry, getErrorMessage(error));
      pump();
      return;
    }
    if (!isInFlight(write.seq)) return;
    if (result.outcome === "refused") rollBackFrom(write, entry, result.message);
    else answer(write, result.response);
    pump();
  };

  const isInFlight = (seq: number): boolean => get().writes.some((w) => w.seq === seq && w.state === "sending");

  const answer = (write: PendingWrite, response: WriteResponse): void => {
    let lane = markAnswered(get().writes, write.seq, { afterRead: get().reads, ...response });
    let aliases = get().aliases;
    let origins = get().origins;
    const { createdId } = response;
    if (write.patch.kind === "create" && createdId !== null) {
      aliases = new Map(aliases).set(write.nodeId, createdId);
      origins = new Map(origins).set(createdId, write.nodeId);
      if (response.createdRowId !== undefined) rows.set(createdId, response.createdRowId);
      lane = resolveTemporary(lane, write.seq, write.nodeId, createdId);
    }
    setLane(lane, { aliases, origins });
    if (write.patch.kind === "create" && createdId !== null) {
      resolvedListeners.forEach((listener) => listener(write.nodeId, createdId));
    }
  };

  /** A refusal (decision 7): the write and what depended on it come off, with one toast. A
   * `message` of `null` is a confirmation the backend holds, which gets none. */
  const rollBackFrom = (write: PendingWrite, entry: WriteSpec, message: string | null, then?: () => void): void => {
    const removal = refuse(get().writes, write.seq);
    const rolledBack = rolledBackCallbacks(removal);
    release(removal);
    setLane(removal.lane, { rollbacks: get().rollbacks + 1 });
    // A create's placeholder is gone, so the notice goes to the node it was to hang under.
    const nodeId = write.patch.kind === "create" ? write.patch.parentId : write.nodeId;
    if (message !== null) {
      entry.showToast({ nodeId, message: entry.refusalToast?.(message) ?? message });
      rolledBack.forEach((reopen) => reopen(message));
    }
    then?.();
  };

  /** The server cannot be reached: everything unanswered comes off, with one toast. */
  const rollBackEverything = (write: PendingWrite, entry: WriteSpec): void => {
    const removal = flush(get().writes);
    const rolledBack = rolledBackCallbacks(removal);
    release(removal);
    setLane(removal.lane, { rollbacks: get().rollbacks + 1 });
    entry.showToast({ nodeId: write.nodeId, message: entry.unreachableMessage });
    rolledBack.forEach((reopen) => reopen(entry.unreachableMessage));
  };

  /** What the removed writes asked to be told, read before their entries are released. */
  const rolledBackCallbacks = (removal: Removal): Array<(reason: string) => void> =>
    removal.removed.flatMap((removed) => {
      const callback = entries.get(removed.seq)?.onRolledBack;
      return callback === undefined ? [] : [callback];
    });

  return {
    writes: [],
    aliases: new Map(),
    origins: new Map(),
    reads: 0,
    rollbacks: 0,
    rowIdFor: (nodeId) => rows.get(nodeId),
    subscribeResolved: (listener) => {
      resolvedListeners.add(listener);
      return () => { resolvedListeners.delete(listener); };
    },
    subscribeRemoved: (listener) => {
      removedListeners.add(listener);
      return () => { removedListeners.delete(listener); };
    },
    enqueue: (spec) => {
      const seq = nextSeq;
      nextSeq += 1;
      entries.set(seq, spec);
      set({ writes: enqueueIn(get().writes, { seq, nodeId: spec.nodeId, patch: spec.patch, label: spec.label }) });
      pump();
      return seq;
    },
    nextTemporaryId: () => {
      const id = `tmp:${nextTemp}`;
      nextTemp += 1;
      return id;
    },
    resolveId,
    isBusy: () => !isDrained(get().writes),
    whenDrained: () =>
      isDrained(get().writes) ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve)),
    cancelTail: () => {
      const { lane, cancelled } = cancelTailOf(get().writes);
      if (cancelled === null) return null;
      entries.delete(cancelled.seq);
      announceRemoved([cancelled]);
      setLane(lane);
      pump();
      return { label: cancelled.label };
    },
    beginRead: () => {
      const reads = get().reads + 1;
      set({ reads });
      return reads;
    },
    reportBoard: (boardId, stamp) => {
      boards.set(boardId, stamp);
      setLane(get().writes);
    },
    forgetBoard: (boardId) => {
      boards.delete(boardId);
      setLane(get().writes);
    },
    reset: () => {
      entries.clear();
      boards.clear();
      rows.clear();
      waiters.splice(0).forEach((wake) => wake());
      nextSeq = 1;
      nextTemp = 1;
      set({ writes: [], aliases: new Map(), origins: new Map(), reads: 0, rollbacks: 0 });
    },
  };
});

/**
 * Waits for the window's lane to empty before a write outside it is sent (ADR 0012, decision 4).
 * With the lane empty, which is almost always, it returns without yielding.
 */
export function awaitLane(): Promise<void> | undefined {
  const { isBusy, whenDrained } = usePendingWritesStore.getState();
  return isBusy() ? whenDrained() : undefined;
}

/**
 * Runs `run` once the window's lane is empty. With the lane empty it runs at once, in the same
 * tick, so a caller outside the lane behaves as it did before the lane existed.
 */
export function afterLane<T>(run: () => Promise<T>): Promise<T> {
  const { isBusy, whenDrained } = usePendingWritesStore.getState();
  return isBusy() ? whenDrained().then(run) : run();
}
