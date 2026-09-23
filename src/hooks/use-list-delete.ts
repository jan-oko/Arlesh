import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { collectSubtreePostOrder } from "@/utils/mindmap-tree";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  /** The same writer the Mindmap's delete uses, so both go through one API layer (and one undo). */
  removeNode: (nodes: Array<{ id: string; kind: NodeKind }>) => Promise<void>;
  /** The row the selection should land on once `deletedIds` are gone, as the list currently reads. */
  neighbourAfterDelete: (id: string, deletedIds: ReadonlySet<string>) => string | null;
  selectRow: (id: string | null) => void;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/** What the confirmation is being asked about: the row itself, and how much goes with it. */
export interface PendingDelete {
  node: MindmapNode;
  /** Everything beneath the row that the cascade takes too — 0 for a leaf. */
  descendantCount: number;
}

interface ListDelete {
  /** The row awaiting confirmation, or `null` when nothing is. */
  pendingDelete: PendingDelete | null;
  isDeleting: boolean;
  /** A refusal from the backend, shown inside the still-open confirmation. */
  error: string | null;
  /** `Delete` on the selected row: raises the confirmation, or refuses out loud. */
  requestDelete: (id: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

/**
 * Deleting the selected List View row, on the Mindmap's terms.
 *
 * Everything that could drift between the two surfaces is shared rather than restated: the same
 * `Delete` chord, the same `DeleteConfirmModal` (so the heading and the "this also deletes N
 * descendants" line are one wording, not two), the same {@link collectSubtreePostOrder} cascade,
 * and the same `removeNode` writer — which is what keeps one undo step covering a delete made from
 * either view. What is left here is only the part a flat list genuinely does differently.
 *
 * Two of those differences are real. The list has **one** selection where the canvas has an anchor
 * and a multi-selection, so a delete is always one row and its subtree. And a **virtual Habit
 * repetition** is refused out loud: it is derived at load time, so there is no row to delete — and
 * the thing behind it, the Habit's template, is emphatically not what `Delete` on one occurrence
 * should take away.
 */
export function useListDelete({
  findNode, removeNode, neighbourAfterDelete, selectRow, showToast,
}: Options): ListDelete {
  const { t } = useTranslation("warnings");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestDelete = useCallback(
    (id: string) => {
      const node = findNode(id);
      if (node === undefined) return;
      if (node.virtual === true) {
        const derivedWait = node.expectationCheck !== undefined || node.delegationWait !== undefined;
        showToast({ nodeId: id, message: t(derivedWait ? "deleteDerivedWaitRefused" : "deleteRepetitionRefused") });
        return;
      }
      setError(null);
      setPendingId(id);
    },
    [findNode, showToast, t],
  );

  const cancelDelete = useCallback(() => {
    setPendingId(null);
    setError(null);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingId === null) return;
    const node = findNode(pendingId);
    if (node === undefined) { setPendingId(null); return; }
    // Post-order: children are written away before the parent they hang from.
    const nodesToDelete = collectSubtreePostOrder(node);
    // Resolved against the list as it stands now, before anything is written — afterwards the row
    // and everything under it are gone, and there is nothing left to measure the neighbour from.
    const neighbourId = neighbourAfterDelete(pendingId, new Set(nodesToDelete.map((entry) => entry.id)));
    setIsDeleting(true);
    setError(null);
    void removeNode(nodesToDelete)
      .then(() => { setPendingId(null); selectRow(neighbourId); })
      .catch((err: unknown) => { setError(getErrorMessage(err)); })
      .finally(() => setIsDeleting(false));
  }, [findNode, neighbourAfterDelete, pendingId, removeNode, selectRow]);

  const pendingNode = pendingId === null ? undefined : findNode(pendingId);
  const pendingDelete: PendingDelete | null = pendingNode === undefined
    ? null
    : { node: pendingNode, descendantCount: collectSubtreePostOrder(pendingNode).length - 1 };

  return { pendingDelete, isDeleting, error, requestDelete, confirmDelete, cancelDelete };
}
