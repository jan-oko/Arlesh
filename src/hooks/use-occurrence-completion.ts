import { useCallback, useState } from "react";
import { setHabitItemStatus, unfinishedChildren } from "@/api/flows";
import type { UnfinishedChild } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";

const LOG_PREFIX = "[occurrence]";

/** A completion the backend is holding until the user says they have seen what it would close over. */
export interface OccurrencePrompt {
  /** The occurrence being marked done, for the heading. */
  title: string;
  /** The unfinished children it still holds, named. */
  children: UnfinishedChild[];
}

/** Advancing a Habit occurrence's status, with the guard that asks before it closes over work. */
export interface OccurrenceCompletion {
  /** The pending confirmation, or `null` when nothing is being asked. */
  prompt: OccurrencePrompt | null;
  /** Writes an occurrence's status. Raises {@link prompt} instead when the backend refuses. */
  setOccurrenceStatus: (node: MindmapNode, status: string | null) => void;
  /** Answers the prompt: the same write again, this time acknowledged. */
  confirm: () => void;
  /** Declines it. Nothing has been written, so nothing is undone. */
  cancel: () => void;
}

/**
 * Marking a Habit occurrence done while it still holds unfinished added children asks first.
 *
 * The question comes from the backend, which refuses the write and names what the occurrence is
 * carrying; this hook turns that refusal into a prompt and the answer into the same write again.
 * Declining changes nothing at all — the first attempt wrote nothing to take back — and confirming
 * marks the occurrence done and leaves the children in place, to archive with it when its window
 * passes. Nothing is stored either way: the guard exists at the moment of completion and nowhere
 * else.
 *
 * Every other status write goes through here untouched, so an occurrence with nothing hanging on
 * it behaves exactly as it did before.
 */
export function useOccurrenceCompletion(reload: () => Promise<void>): OccurrenceCompletion {
  const [pending, setPending] = useState<
    { node: MindmapNode; status: string | null; children: UnfinishedChild[] } | null
  >(null);

  const write = useCallback(
    (node: MindmapNode, status: string | null, confirmed: boolean) => {
      const item = node.habitItem;
      if (item === undefined) return;
      const { flowId, itemType, itemId, scopeId, cycleId } = item;
      void setHabitItemStatus(
        flowId, itemType, itemId, scopeId, cycleId, status, Date.now(),
        confirmed ? true : undefined,
      )
        .then(() => {
          setPending(null);
          return reload();
        })
        .catch((err: unknown) => {
          const open = unfinishedChildren(err);
          // The one rejection that is a question rather than a failure — and only on the first
          // attempt, since a confirmed write that still comes back this way is a real problem.
          if (open !== null && !confirmed) {
            setPending({ node, status, children: open });
            return;
          }
          console.error(`${LOG_PREFIX} habit item status failed:`, err);
        });
    },
    [reload],
  );

  const setOccurrenceStatus = useCallback(
    (node: MindmapNode, status: string | null) => { write(node, status, false); },
    [write],
  );

  const confirm = useCallback(() => {
    if (pending !== null) write(pending.node, pending.status, true);
  }, [pending, write]);

  const cancel = useCallback(() => { setPending(null); }, []);

  return {
    prompt: pending === null ? null : { title: pending.node.title, children: pending.children },
    setOccurrenceStatus,
    confirm,
    cancel,
  };
}
