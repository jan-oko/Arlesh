import { useCallback, useState } from "react";
import { unfinishedChildren } from "@/api/flows";
import type { UnfinishedChild } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";

/** A completion the backend is holding until the user says they have seen what it would close over. */
export interface OccurrencePrompt {
  /** The occurrence being marked done, for the heading. */
  title: string;
  /** The unfinished children it still holds, named. */
  children: UnfinishedChild[];
}

/**
 * One status write, as the guard runs it: `confirmed` is `false` the first time and `true` once the
 * user has seen what it closes over. It does its own follow-up (reload, toasts) on success.
 */
export type GuardedWrite = (confirmed: boolean) => Promise<void>;

/** Writing a status, with the guard that asks before an occurrence closes over work. */
export interface OccurrenceCompletion {
  /** The pending confirmation, or `null` when nothing is being asked. */
  prompt: OccurrencePrompt | null;
  /** Runs `write` for `node`. Raises {@link prompt} instead when the backend refuses it for
   * unfinished children; any other failure goes to `onError`. */
  guard: (node: MindmapNode, write: GuardedWrite, onError: (error: unknown) => void) => void;
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
 * An occurrence is an ordinary row (ADR 0008), so its status is written by the same `updateTask` /
 * `updateGoal` as any other; every write that is not refused this way passes straight through.
 */
export function useOccurrenceCompletion(): OccurrenceCompletion {
  const [pending, setPending] = useState<
    { node: MindmapNode; write: GuardedWrite; onError: (error: unknown) => void; children: UnfinishedChild[] } | null
  >(null);

  const run = useCallback(
    (node: MindmapNode, write: GuardedWrite, onError: (error: unknown) => void, confirmed: boolean) => {
      void write(confirmed)
        .then(() => { setPending(null); })
        .catch((err: unknown) => {
          const open = unfinishedChildren(err);
          // The one rejection that is a question rather than a failure — and only on the first
          // attempt, since a confirmed write that still comes back this way is a real problem.
          if (open !== null && !confirmed) {
            setPending({ node, write, onError, children: open });
            return;
          }
          setPending(null);
          onError(err);
        });
    },
    [],
  );

  const guard = useCallback(
    (node: MindmapNode, write: GuardedWrite, onError: (error: unknown) => void) => {
      run(node, write, onError, false);
    },
    [run],
  );

  const confirm = useCallback(() => {
    if (pending !== null) run(pending.node, pending.write, pending.onError, true);
  }, [pending, run]);

  const cancel = useCallback(() => { setPending(null); }, []);

  return {
    prompt: pending === null ? null : { title: pending.node.title, children: pending.children },
    guard,
    confirm,
    cancel,
  };
}
