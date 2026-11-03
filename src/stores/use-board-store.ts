import { create } from "zustand";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { agentActivityFrom } from "@/utils/agent-activity";
import { getErrorMessage } from "@/api/errors";
import { loadMindmap } from "@/api/mindmap";
import type { MindmapLoad } from "@/api/mindmap";
import { listPeople } from "@/api/people";
import { createBoardRevisionTracker } from "@/stores/board-revision-store";
import type { BoardRevisionTracker } from "@/stores/board-revision-store";
import { isClientMode, useClientModeStore } from "@/stores/use-client-mode-store";
import { useMcpAccessStore } from "@/stores/use-mcp-access-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { watchBoardChanges } from "@/stores/watch-board-changes";
import { localNowIso } from "@/utils/local-now";
import { isReflected } from "@/utils/pending-writes";
import type { BoardStamp } from "@/utils/pending-writes";

/**
 * The board as the server gave it, before any view has drawn it: the whole `load_mindmap` answer,
 * the instant it was read at, the names of the Persons Tasks are delegated to, and the stamp of
 * the read it came from. Every view derives its own tree from this.
 */
export interface SharedBoard {
  load: MindmapLoad;
  /** The local time the read was made at, which Habit iteration roots judge "passed" against. */
  now: string;
  personNames: ReadonlyMap<number, string>;
  stamp: BoardStamp;
}

interface BoardStore {
  /** The window's one copy of the board; `null` before the first load lands and while no view is mounted. */
  board: SharedBoard | null;
  /** True until the first load has ended, whether it brought a board or an error. */
  isLoading: boolean;
  /** Why the latest load failed; `null` after one that did not. The board stays as it was. */
  error: string | null;
  /** The revision the window's copy of the board is at. One per window: there is one copy. */
  tracker: BoardRevisionTracker;
  /**
   * Loads the board and resolves once a board that is **at least as new as this call** is held (or
   * the load failed, which sets `error`; it never rejects).
   *
   * Single-flight. With no load under way it starts one. With one under way, that one may have been
   * read before the news the caller has (a write it just made), so it asks for exactly one
   * follow-up, and every call that arrives meanwhile shares that follow-up.
   */
  load: () => Promise<void>;
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

export const useBoardStore = create<BoardStore>()((set, get) => {
  const tracker = createBoardRevisionTracker();
  let views = 0;
  let stopListening: (() => void) | null = null;
  // The load under way, and the one follow-up waiting behind it.
  let current: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  /** Whether an answered write is not yet on a board and no read has begun since it arrived. */
  const answerNeedsRead = (): boolean => {
    const { board } = get();
    if (board === null) return false;
    const { writes, reads } = usePendingWritesStore.getState();
    return writes.some(({ answer }) => answer !== null && answer.afterRead >= reads && !isReflected(answer, board.stamp));
  };

  const run = async (): Promise<void> => {
    set({ error: null });
    try {
      const now = localNowIso();
      const read = usePendingWritesStore.getState().beginRead();
      tracker.getState().loadStarted();
      let data: MindmapLoad;
      try {
        data = await loadMindmap(now);
      } catch (err) {
        tracker.getState().loadFailed();
        throw err;
      }
      tracker.getState().loadFinished(data.revision ?? null);
      // People are read only when a Task is delegated to one: their names are what a Person
      // delegate's badge and wait are labelled with, and nothing else on the board needs them.
      const personNames = data.tasks.some((task) => task.delegate_to != null)
        ? await loadPersonNames()
        : new Map<number, string>();
      // Nobody is looking any more: the next view to mount loads afresh.
      if (views === 0) return;
      const stamp: BoardStamp = { read, epoch: data.revision?.epoch ?? null, revision: data.revision?.revision ?? null };
      set({ board: { load: data, now, personNames, stamp } });
      usePendingWritesStore.getState().reportBoard(stamp);
      // The whole board, before any view narrows it to a subtree: the top bar's agent status.
      useAgentActivityStore.getState().receive(agentActivityFrom(data.agent_activity));
      if (answerNeedsRead()) void get().load();
    } catch (err) {
      if (views > 0) set({ error: getErrorMessage(err) });
    } finally {
      // An idle store keeps its first-load state, so the next view's first render shows the spinner.
      if (views > 0) set({ isLoading: false });
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

  const listen = (): (() => void) => {
    const stopBoard = watchBoardChanges(load, tracker);
    // After an answer the board reloads, unless it already reflects the write (ADR 0012, decision 5).
    const stopLane = usePendingWritesStore.subscribe((state, previous) => {
      if (state.writes !== previous.writes && answerNeedsRead()) void load();
    });
    // A change to the MCP roots made in this window redraws the "visible to the MCP" badges.
    const stopMcp = useMcpAccessStore.subscribe((state, previous) => {
      if (state.revision !== previous.revision) void load();
    });
    return () => { stopBoard(); stopLane(); stopMcp(); };
  };

  return {
    board: null,
    isLoading: true,
    error: null,
    tracker,
    load,
    acquire: () => {
      views += 1;
      if (views === 1) {
        // A window that had no view heard nothing in the meantime: what it held is not to be trusted.
        tracker.setState({ held: null });
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
        set({ board: null, isLoading: true, error: null });
        usePendingWritesStore.getState().reportBoard(null);
      };
    },
  };
});
