import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { canArchiveByHand, isArchivedByHand, DOMAIN_ARCHIVED_STATUS } from "@/utils/hand-archive";
import { updateTask, TASK_ARCHIVAL } from "@/api/tasks";
import { updateCommitment, COMMITMENT_ARCHIVAL } from "@/api/commitments";
import { updateDomain } from "@/api/domains";
import { storedId } from "@/api/node-id";
import { getErrorMessage } from "@/api/errors";

interface Options {
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface Result {
  /** Archives the node by hand, or unarchives it when it is the one archived. Acts on one node. */
  toggleArchive: (nodeId: string) => void;
}

/** The write that puts `node` away by hand — `archive` true — or brings it back Live. */
function writeArchive(node: MindmapNode, archive: boolean): Promise<unknown> {
  const rowId = rowIdOf(node);
  // A Domain unarchives to Active, which the backend stores as no status at all.
  if (node.kind === "domain") {
    return updateDomain(storedId(rowId), { status: archive ? DOMAIN_ARCHIVED_STATUS : "active" });
  }
  if (node.kind === "commitment") {
    return updateCommitment(rowId, { archival: archive ? COMMITMENT_ARCHIVAL.ARCHIVED : COMMITMENT_ARCHIVAL.LIVE });
  }
  return updateTask(rowId, { archival: archive ? TASK_ARCHIVAL.ARCHIVED : TASK_ARCHIVAL.LIVE });
}

/**
 * The hand archive shared by the context menus (Task 269): Archive on a stored Task or Commitment
 * — or a Domain (Task bd3) — puts it away with everything beneath it; Unarchive on the one archived makes it Live again. One
 * write — the stored archival of that node alone — so one undo step; the subtree reads as archived
 * through the backend's lifecycle and comes back untouched. A refusal is a toast, never silent.
 */
export function useHandArchive({ findNode, reload, showToast }: Options): Result {
  const { t } = useTranslation("warnings");

  const toggleArchive = useCallback(
    (nodeId: string) => {
      const node = findNode(nodeId);
      if (node === undefined || !canArchiveByHand(node)) return;
      void writeArchive(node, !isArchivedByHand(node)).then(
        () => reload(),
        (error: unknown) => showToast({ nodeId, message: t("archiveFailed", { message: getErrorMessage(error) }) }),
      );
    },
    [findNode, reload, showToast, t],
  );

  return { toggleArchive };
}
