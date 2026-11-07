import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useStatusCycle } from "@/hooks/use-status-cycle";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { decideStart } from "@/utils/search-start";
import type { StartRefusal } from "@/utils/search-start";
import { findNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/** The `warnings` key that says why `Alt+S` started nothing. */
const REFUSAL_MESSAGE: Record<StartRefusal, "startNotATask" | "startUnsettled" | "compoundStatusRefused" | "startBlocked"> = {
  not_a_task: "startNotATask",
  unsettled: "startUnsettled",
  compound: "compoundStatusRefused",
  blocked: "startBlocked",
};

/**
 * `Alt+S` in the node search (`Ctrl+O`): the one seam every view hands its modal. It returns what the
 * modal calls with the highlighted row's id — the Task goes to In Progress (Doing, if Agentic) through
 * the same status write the views use, and a toast names it; a row that cannot be started says why in a
 * toast instead. The row is read from `tree` at the moment of the press, so it is the status the board
 * shows now, not the one the search list was built from.
 */
export function useSearchStart(tree: MindmapNode): (nodeId: string) => void {
  const { t } = useTranslation("warnings");
  const showToast = useMindmapStore((s) => s.showToast);
  const find = useCallback((id: string) => findNode(tree, id), [tree]);
  const { setTaskStatus } = useStatusCycle({ findNode: find, showToast });

  return useCallback(
    (nodeId: string) => {
      const node = find(nodeId);
      const title = node?.title ?? "";
      const decision = decideStart(node);
      if (decision.outcome === "refused") {
        showToast({ nodeId, message: t(REFUSAL_MESSAGE[decision.reason], { title }) });
        return;
      }
      if (decision.outcome === "write") setTaskStatus(nodeId, decision.status);
      const message = decision.status.kind === "agentic" ? "startedDoing" : "startedInProgress";
      showToast({ nodeId, message: t(message, { title }) });
    },
    [find, showToast, setTaskStatus, t],
  );
}
