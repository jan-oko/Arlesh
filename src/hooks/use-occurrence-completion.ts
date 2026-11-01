import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import { unfinishedChildren } from "@/api/flows";
import type { UnfinishedChild } from "@/api/flows";
import { usePendingWrite } from "@/hooks/use-pending-write";
import type { NodePatch } from "@/utils/pending-writes";
import type { WriteResult } from "@/stores/use-pending-writes-store";
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

/** One status write that may be held for the user's confirmation, as the lane takes it. */
export interface GuardedAction {
  /** What the user would call it, for the undo notice. */
  label: string;
  /** What the board shows meanwhile. */
  patch: NodePatch;
  /** Sends it. `confirmed` is `false` the first time and `true` once the user has seen what it closes over. */
  send: (confirmed: boolean) => Promise<WriteResult>;
  /** What to show on a read-only board, where nothing is patched or sent. */
  refuseReadOnly: () => void;
}

/** Writing a status, with the guard that asks before an occurrence closes over work. */
export interface OccurrenceCompletion {
  /** The pending confirmation, or `null` when nothing is being asked. */
  prompt: OccurrencePrompt | null;
  /** Puts `action` in the window's lane for `node`, shown at once. When the backend holds it for
   * unfinished children, the patch rolls back without a toast and {@link prompt} opens instead. */
  submit: (node: MindmapNode, action: GuardedAction) => void;
  /** Answers the prompt: the same action again, patch and all, this time acknowledged. */
  confirm: () => void;
  /** Declines it. The held write was rolled back, so there is nothing to undo. */
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
 * The occurrence reads not Done while the question is open, which is the truth: the lane rolls the
 * patch back on the refusal (ADR 0012, decision 7) rather than holding every other write behind a
 * prompt of indefinite length. Declining changes nothing, and confirming marks the occurrence done
 * and leaves the children in place, to archive with it when its window passes. Nothing is stored
 * either way: the guard exists at the moment of completion and nowhere else.
 *
 * An occurrence is an ordinary row (ADR 0008), so its status is written like any other; every
 * write that is not refused this way passes straight through.
 */
export function useOccurrenceCompletion({ showToast }: Options): OccurrenceCompletion {
  const { t } = useTranslation("warnings");
  const enqueue = usePendingWrite({ showToast });
  const [pending, setPending] = useState<
    { node: MindmapNode; action: GuardedAction; children: UnfinishedChild[] } | null
  >(null);

  const run = useCallback(
    (node: MindmapNode, action: GuardedAction, confirmed: boolean): void => {
      // What the backend said, kept from the rejection to the store's confirmation call.
      let open: UnfinishedChild[] | null = null;
      let said = "";
      enqueue({
        nodeId: node.id,
        label: action.label,
        patch: action.patch,
        refuseReadOnly: action.refuseReadOnly,
        send: async () => {
          try {
            return await action.send(confirmed);
          } catch (error: unknown) {
            // The one rejection that is a question rather than a failure, and only on the first
            // attempt: a confirmed write that still comes back this way is a real problem.
            open = confirmed ? null : unfinishedChildren(error);
            said = getErrorMessage(error);
            throw error;
          }
        },
        onConfirmation: () => {
          if (open === null) {
            showToast({ nodeId: node.id, message: t("statusChangeFailed", { message: said }) });
            return;
          }
          setPending({ node, action, children: open });
        },
      });
    },
    [enqueue, showToast, t],
  );

  const submit = useCallback((node: MindmapNode, action: GuardedAction) => { run(node, action, false); }, [run]);

  const confirm = useCallback(() => {
    if (pending === null) return;
    setPending(null);
    run(pending.node, pending.action, true);
  }, [pending, run]);

  const cancel = useCallback(() => { setPending(null); }, []);

  return {
    prompt: pending === null ? null : { title: pending.node.title, children: pending.children },
    submit,
    confirm,
    cancel,
  };
}
