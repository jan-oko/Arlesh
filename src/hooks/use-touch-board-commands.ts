import { useTranslation } from "react-i18next";
import { useTouchCommand } from "@/hooks/use-touch-command";
import type { MindmapNode } from "@/utils/tree-layout";
import { rowIdOf } from "@/utils/node-identity";
import { archivePlanFor, openCheckOf } from "@/utils/touch/board-writes";
import { archiveNodes } from "@/api/multi-node-gestures";
import type { ArchiveWrite } from "@/api/multi-node-gestures";
import { updateTask } from "@/api/tasks";
import { storedId } from "@/api/node-id";
import { getErrorMessage } from "@/api/errors";

interface Options {
  /** The nodes selected now, read when a command asks whether it can act or runs. */
  selection: () => MindmapNode[];
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

function archiveWriteOf(node: MindmapNode, archive: boolean): ArchiveWrite {
  const id = rowIdOf(node);
  if (node.kind === "domain") return { kind: "domain", id: storedId(id), archive };
  return { kind: node.kind === "commitment" ? "commitment" : "task", id, archive };
}

/**
 * The two action-bar slots no key backs (`docs/spec/touch.md`): *Check done* on a wait, which
 * completes its earliest open check, and *Archive* on a selection, which puts every node that takes
 * the hand archive away as one undo step. A node the archive skips is said so, never dropped
 * silently. The calling view publishes them for as long as it is mounted.
 */
export function useTouchBoardCommands({ selection, reload, showToast }: Options): void {
  const { t } = useTranslation(["touch", "warnings"]);

  function selectedWait(): MindmapNode | undefined {
    const [only, ...rest] = selection();
    return only !== undefined && rest.length === 0 ? only : undefined;
  }

  useTouchCommand({
    id: "touch.checkDone",
    labelKey: "commandCheckDone",
    canRun: () => {
      const wait = selectedWait();
      return wait !== undefined && openCheckOf(wait)?.rowId !== undefined;
    },
    run: () => {
      const wait = selectedWait();
      const check = wait === undefined ? undefined : openCheckOf(wait);
      if (wait === undefined || check === undefined) return;
      void updateTask(rowIdOf(check), { status: { kind: "ordinary", status: "done" } }).then(
        () => reload(),
        (error: unknown) => showToast({ nodeId: wait.id, message: t("touch:checkDoneFailed", { message: getErrorMessage(error) }) }),
      );
    },
  });

  useTouchCommand({
    id: "touch.archiveSelection",
    labelKey: "commandArchive",
    canRun: () => archivePlanFor(selection()) !== null,
    run: () => {
      const selected = selection();
      const plan = archivePlanFor(selected);
      const [first] = selected;
      if (plan === null || first === undefined) return;
      void archiveNodes(plan.nodes.map((node) => archiveWriteOf(node, plan.archive))).then(
        () => {
          if (plan.skipped > 0) showToast({ nodeId: first.id, message: t("touch:archiveSkipped", { count: plan.skipped }) });
          return reload();
        },
        (error: unknown) => showToast({ nodeId: first.id, message: t("warnings:archiveFailed", { message: getErrorMessage(error) }) }),
      );
    },
  });
}
