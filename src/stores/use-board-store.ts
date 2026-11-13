import { create } from "zustand";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { agentActivityFrom } from "@/utils/agent-activity";
import { boardFence, boardHead, reportBoardDivergence } from "@/api/board";
import type { BoardChange, BoardHead, DivergenceReport } from "@/api/board";
import { getErrorMessage } from "@/api/errors";
import { loadMindmap } from "@/api/mindmap";
import type { CurrentBoard, MindmapLoad } from "@/api/mindmap";
import { listPeople } from "@/api/people";
import { isClientMode, useClientModeStore } from "@/stores/use-client-mode-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { watchBoardChanges } from "@/stores/watch-board-changes";
import { applyBoardChanges, differingCollections, digestsOf, indexBoard } from "@/utils/board-changes";
import type { BoardDigests } from "@/utils/board-changes";
import { localNowIso } from "@/utils/local-now";
import type { BoardStamp } from "@/utils/pending-writes";

/**
 * How long a writer waits to hold the board its write brought about before it gives up on the
 * event and loads the board whole (ADR 0020, decision 13). Reaching it means an event was lost or
 * a write was never recorded: a bug, so it is logged.
 */
export const SETTLE_TIMEOUT_MS = 5000;

/** How long a head seen ahead of the window may stay ahead before the window decides it missed an event. */
export const BEHIND_GRACE_MS = 10000;

/**
 * The board as the producer published it, before any view has drawn it: the whole board, the
 * instant it was derived at, the names of the Persons Tasks are delegated to, which publication it
 * is, and the digest of every entry it holds. Every view derives its own tree from this.
 */
export interface SharedBoard {
  load: MindmapLoad;
  /** The local time the board was derived at, which Habit iteration roots judge "passed" against. */
  now: string;
  personNames: ReadonlyMap<number, string>;
  stamp: BoardStamp;
  /** The digest of every entry the window holds, kept up to date as changes are applied. */
  digests: BoardDigests;
}

interface BoardStore {
  /** The window's one copy of the board; `null` before the first load lands and while no view is mounted. */
  board: SharedBoard | null;
  /** True until the first load has ended, whether it brought a board or an error. */
  isLoading: boolean;
  /** Why the latest load failed; `null` after one that did not. The board stays as it was. */
  error: string | null;
  /**
   * Loads the whole board and resolves once a board that is **at least as new as this call** is held
   * (or the load failed, which sets `error`; it never rejects). For the first view, a gap in the
   * events, a new run of the producer, a hash mismatch and a wait that ran out: a write does not
   * reload.
   *
   * Single-flight. With no load under way it starts one. With one under way, that one may have been
   * read before the news the caller has, so it asks for exactly one follow-up, and every call that
   * arrives meanwhile shares that follow-up.
   */
  load: () => Promise<void>;
  /**
   * Takes in a `board-changed` event: applies its changed nodes to the board the window holds, or
   * loads the board whole when the event says to, skips a gap or brings another run.
   */
  applyChange: (change: BoardChange | null) => void;
  /**
   * Resolves once the window holds the board its own latest write brought about: the backend's
   * fence is the newest revision a write reached, and the board is at it when a change event has
   * been applied for it. After five seconds it loads the board whole instead and says so.
   */
  settle: () => Promise<void>;
  /**
   * A view of the board has mounted. The first one starts the window's single load and its
   * listeners; later ones find the board already loading or loaded. Returns the release.
   */
  acquire: () => () => void;
}

/** People are Standalone-only: a server has none to name (docs/spec/client-mode.md). */
async function loadPersonNames(): Promise<Map<number, string>> {
  if (isClientMode(useClientModeStore.getState().status)) return new Map();
  try {
    const people = await listPeople();
    return new Map((people ?? []).map((person) => [person.id, person.name]));
  } catch (error: unknown) {
    console.warn("[arlesh] could not read people's names:", error);
    return new Map();
  }
}

/** Whether a Task row delegates to a Person the window cannot name. */
function delegatesToUnnamedPerson(set: ReadonlyArray<readonly [string, unknown]>, names: ReadonlyMap<number, string>): boolean {
  return set.some(([, value]) => {
    if (typeof value !== "object" || value === null) return false;
    const delegate: unknown = Reflect.get(value, "delegate_to");
    if (typeof delegate !== "object" || delegate === null) return false;
    const id: unknown = Reflect.get(delegate, "id");
    return Reflect.get(delegate, "kind") === "person" && typeof id === "number" && !names.has(id);
  });
}

interface Settler {
  epoch: string;
  revision: number;
  done: () => void;
}

export const useBoardStore = create<BoardStore>()((set, get) => {
  let views = 0;
  let stopListening: (() => void) | null = null;
  // The load under way, and the one follow-up waiting behind it.
  let current: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;
  // Events that arrive while a load is under way wait for it, and are applied after it in order.
  let loading = false;
  let buffered: BoardChange[] = [];
  // Writers waiting to hold the revision of their write.
  let settlers: Settler[] = [];
  // Set when the window's board first disagrees with the producer's right after a full load: that
  // can only be a defect in how the two sides write a board, so it is reported once and the window
  // stops comparing hashes (sequence checks go on) rather than reloading in a loop.
  let hashChecks = true;
  // The newest head seen ahead of the board, and when: a head still ahead after the grace missed an event.
  let behind: { seq: number; since: number } | null = null;

  const reached = (board: SharedBoard, settler: Settler): boolean =>
    board.stamp.epoch === settler.epoch && board.stamp.revision !== null && board.stamp.revision >= settler.revision;

  const releaseSettlers = (): void => {
    const { board } = get();
    if (board === null) return;
    const waiting = settlers;
    settlers = waiting.filter((settler) => !reached(board, settler));
    waiting.filter((settler) => reached(board, settler)).forEach((settler) => settler.done());
  };

  const report = (found_by: DivergenceReport["found_by"], board: SharedBoard, head: { seq: number | null; hash: number; sums?: Record<string, number> }): void => {
    void reportBoardDivergence({
      found_by,
      epoch: board.stamp.epoch ?? "",
      window_seq: board.stamp.seq,
      head_seq: head.seq,
      window_hash: board.digests.total,
      head_hash: head.hash,
      collections: head.sums === undefined ? [] : differingCollections(board.digests.sums, head.sums),
    });
  };

  /** Puts a board the window just took in on screen, and lets the lane and the writers know, in one step. */
  const hold = (board: SharedBoard): void => {
    set({ board });
    usePendingWritesStore.getState().reportBoard(board.stamp);
    releaseSettlers();
  };

  const run = async (): Promise<void> => {
    set({ error: null });
    loading = true;
    try {
      const now = localNowIso();
      const read = usePendingWritesStore.getState().beginRead();
      const data: CurrentBoard = await loadMindmap();
      // People are read only when a Task is delegated to one: their names are what a Person
      // delegate's badge and wait are labelled with, and nothing else on the board needs them.
      const personNames = data.load.tasks.some((task) => task.delegate_to != null)
        ? await loadPersonNames()
        : new Map<number, string>();
      // Nobody is looking any more: the next view to mount loads afresh.
      if (views === 0) return;
      const held = indexBoard(data.load);
      const stamp: BoardStamp = {
        read,
        epoch: data.revision?.epoch ?? null,
        seq: data.seq ?? null,
        revision: data.revision?.revision ?? null,
        at: Date.now(),
      };
      const board: SharedBoard = { load: data.load, now: data.now ?? now, personNames, stamp, digests: held.digests };
      if (hashChecks && data.hash !== undefined && held.digests.total !== data.hash) {
        hashChecks = false;
        report("load", board, { seq: data.seq ?? null, hash: data.hash });
      }
      hold(board);
      // The whole board, before any view narrows it to a subtree: the top bar's agent status.
      useAgentActivityStore.getState().receive(agentActivityFrom(data.load.agent_activity));
    } catch (err) {
      if (views > 0) set({ error: getErrorMessage(err) });
    } finally {
      loading = false;
      // An idle store keeps its first-load state, so the next view's first render shows the spinner.
      if (views > 0) set({ isLoading: false });
      const waiting = buffered;
      buffered = [];
      // What arrived during the load: those the load already holds are dropped, the rest applied in order.
      for (const change of waiting) get().applyChange(change);
    }
  };

  const load = (): Promise<void> => {
    if (current === null) {
      current = run().finally(() => { current = null; });
      return current;
    }
    followUp ??= current.then(() => {
      followUp = null;
      return load();
    });
    return followUp;
  };

  const applyChange = (change: BoardChange | null): void => {
    if (views === 0) return;
    if (loading) {
      if (change === null) void load();
      else buffered.push(change);
      return;
    }
    const held = get().board;
    if (change === null || held === null) {
      void load();
      return;
    }
    const { stamp } = held;
    const sameRun = stamp.epoch !== null && stamp.epoch === change.epoch;
    if (sameRun && change.seq !== undefined && stamp.seq !== null && change.seq <= stamp.seq) return;
    const next = stamp.seq === null ? null : stamp.seq + 1;
    if (!sameRun || change.seq === undefined || change.seq !== next || change.reload === true || change.changes === undefined) {
      void load();
      return;
    }
    const applied = applyBoardChanges({ load: held.load, digests: held.digests }, change.changes);
    const read = usePendingWritesStore.getState().beginRead();
    const board: SharedBoard = {
      load: applied.load,
      now: change.now ?? held.now,
      personNames: held.personNames,
      stamp: { read, epoch: change.epoch, seq: change.seq, revision: change.revision, at: Date.now() },
      digests: applied.digests,
    };
    if (hashChecks && change.hash !== undefined && applied.digests.total !== change.hash) {
      report("event", board, { seq: change.seq, hash: change.hash });
      void load();
      return;
    }
    hold(board);
    if (change.changes.agent_activity !== undefined) {
      useAgentActivityStore.getState().receive(agentActivityFrom(applied.load.agent_activity));
    }
    const tasks = change.changes.tasks;
    if (tasks !== undefined && delegatesToUnnamedPerson(tasks.set, held.personNames)) void refreshPeople();
  };

  /** A Task came to be delegated to a Person the window cannot name: read the names again. */
  const refreshPeople = async (): Promise<void> => {
    const personNames = await loadPersonNames();
    const board = get().board;
    if (board !== null && views > 0) set({ board: { ...board, personNames } });
  };

  const settle = async (): Promise<void> => {
    const fence = await boardFence();
    const board = get().board;
    if (fence === null || board === null) {
      await load();
      return;
    }
    const settler: Settler = { epoch: fence.epoch, revision: fence.revision, done: () => {} };
    if (reached(board, settler)) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        settlers = settlers.filter((waiting) => waiting !== settler);
        console.warn("[arlesh] the board did not reach the revision of its own write in time; loading it whole", fence);
        void load().then(resolve);
      }, SETTLE_TIMEOUT_MS);
      settler.done = () => {
        clearTimeout(timer);
        resolve();
      };
      settlers.push(settler);
    });
  };

  /** Compares the window's board with the producer's head: another run, a missed event, or a mismatch. */
  const checkHead = async (): Promise<void> => {
    const head = await boardHead();
    const board = get().board;
    if (head === null || board === null || loading || views === 0) return;
    if (head.epoch !== board.stamp.epoch) {
      void load();
      return;
    }
    const seq = board.stamp.seq;
    if (seq === null) return;
    if (head.seq > seq) {
      if (behind !== null && behind.seq <= head.seq && Date.now() - behind.since >= BEHIND_GRACE_MS) {
        behind = null;
        console.warn("[arlesh] the board missed an event; loading it whole", { held: seq, head: head.seq });
        void load();
      } else behind ??= { seq: head.seq, since: Date.now() };
      return;
    }
    behind = null;
    if (head.seq === seq && hashChecks && head.hash !== board.digests.total) {
      report("head", board, head);
      void load();
    }
  };

  /** Works every entry's digest out again from the values held, and compares it with the running sum and the head. */
  const recompute = async (): Promise<void> => {
    const board = get().board;
    if (board === null || loading || views === 0 || !hashChecks) return;
    const fresh = digestsOf(board.load);
    const head: BoardHead | null = await boardHead();
    const stillHeld = get().board;
    if (stillHeld === null || stillHeld.stamp !== board.stamp) return;
    if (fresh.total !== board.digests.total) {
      report("recompute", board, { seq: head?.seq ?? null, hash: fresh.total, sums: fresh.sums });
      void load();
      return;
    }
    if (head !== null && head.epoch === board.stamp.epoch && head.seq === board.stamp.seq && head.hash !== fresh.total) {
      report("recompute", board, head);
      void load();
    }
  };

  const listen = (): (() => void) => watchBoardChanges({ applyChange, checkHead, recompute });

  return {
    board: null,
    isLoading: true,
    error: null,
    load,
    applyChange,
    settle,
    acquire: () => {
      views += 1;
      if (views === 1) {
        // A window that had no view heard nothing in the meantime: what it held is not to be trusted.
        behind = null;
        set({ board: null, isLoading: true, error: null });
        usePendingWritesStore.getState().reportBoard(null);
        stopListening = listen();
      }
      // A later view finds the load under way, or the board there: it does not ask for another.
      if (get().board === null && current === null) void load();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        views -= 1;
        if (views > 0) return;
        stopListening?.();
        stopListening = null;
        buffered = [];
        settlers.splice(0).forEach((settler) => settler.done());
        set({ board: null, isLoading: true, error: null });
        usePendingWritesStore.getState().reportBoard(null);
      };
    },
  };
});
