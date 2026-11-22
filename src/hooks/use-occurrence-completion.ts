import { useCallback, useState } from "react";
import { getErrorMessage } from "@/api/errors";
import { unfinishedChildren } from "@/api/flows";
import type { UnfinishedChild } from "@/api/flows";
import { currentReadOnlyReason } from "@/hooks/use-board-read-only";
import type { MindmapNode } from "@/utils/tree-layout";

/** A completion the backend is holding until the user says they have seen what it would close over. */
export interface OccurrencePrompt {
  /** The occurrence being marked done, for the heading. */
  title: string;
  /** The unfinished children it still holds, named. */
  children: UnfinishedChild[];
}

/**
 * The trailing `confirmed` argument of an update, as a write run by the guard passes it: nothing
 * on the first attempt, so an ordinary write is the same call it always was, and `true` once the
 * user has answered the prompt.
 */
export function acknowledged(confirmed: boolean): [] | [true] {
  return confirmed ? [true] : [];
}

/** One status write that may be held for the user's confirmation. */
export interface GuardedAction {
  /** Sends it. `confirmed` is `false` the first time and `true` once the user has seen what it closes over. */
  send: (confirmed: boolean) => Promise<void>;
  /** What to show on a read-only board, where nothing is sent. */
  refuseReadOnly: () => void;
}

/** Writing a status, with the guard that asks before an occurrence closes over work. */
export interface OccurrenceCompletion {
  /** The pending confirmation, or `null` when nothing is being asked. */
  prompt: OccurrencePrompt | null;
  /** Sends `action` for `node`. When the backend holds it for unfinished children, nothing was
   * written and {@link prompt} opens instead; any other refusal is a toast. */
  submit: (node: MindmapNode, action: GuardedAction) => Promise<void>;
  /** Answers the prompt: the same action again, this time acknowledged. */
  confirm: () => void;
  /** Declines it. The held write was refused, so there is nothing to undo. */
  cancel: () => void;
}

interface Options {
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * Marking a Habit occurrence done while it still holds unfinished added children asks first.
 *
 * The question comes from the backend, which refuses the write and names what the occurrence is
 * carrying; this hook turns that refusal into a prompt and the answer into the same write again.
 * The occurrence reads not Done while the question is open, which is the truth: the backend wrote
 * nothing. Declining changes nothing, and confirming marks the occurrence done
 * and leaves the children in place, to archive with it when its window passes. Nothing is stored
 * either way: the guard exists at the moment of completion and nowhere else.
 *
 * An occurrence is an ordinary row (ADR 0008), so its status is written like any other; every
 * write that is not refused this way passes straight through.
 */
export function useOccurrenceCompletion({ showToast }: Options): OccurrenceCompletion {
  const [pending, setPending] = useState<
    { node: MindmapNode; action: GuardedAction; children: UnfinishedChild[] } | null
  >(null);

  const run = useCallback(
    async (node: MindmapNode, action: GuardedAction, confirmed: boolean): Promise<void> => {
      if (currentReadOnlyReason() !== null) {
        action.refuseReadOnly();
        return;
      }
      try {
        await action.send(confirmed);
      } catch (error: unknown) {
        // The one rejection that is a question rather than a failure, and only on the first
        // attempt: a confirmed write that still comes back this way is a real problem.
        const open = confirmed ? null : unfinishedChildren(error);
        if (open === null) {
          showToast({ nodeId: node.id, message: getErrorMessage(error) });
          return;
        }
        setPending({ node, action, children: open });
      }
    },
    [showToast],
  );

  const submit = useCallback((node: MindmapNode, action: GuardedAction) => run(node, action, false), [run]);

  const confirm = useCallback(() => {
    if (pending === null) return;
    setPending(null);
    void run(pending.node, pending.action, true);
  }, [pending, run]);

  const cancel = useCallback(() => { setPending(null); }, []);

  return {
    prompt: pending === null ? null : { title: pending.node.title, children: pending.children },
    submit,
    confirm,
    cancel,
  };
}
