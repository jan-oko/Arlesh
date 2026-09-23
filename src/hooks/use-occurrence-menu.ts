import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { setHabitInstanceArchived, setHabitInstancePlan } from "@/api/flows";
import type { PlanOverride } from "@/api/flows";
import { getErrorMessage } from "@/api/errors";
import { editableOccurrence } from "@/hooks/use-occurrence-editor";
import type { OccurrenceMenuAction, OccurrenceStatus } from "@/utils/occurrence-menu";
import { storedOccurrenceStatus } from "@/utils/occurrence-menu";
import type { MindmapNode } from "@/utils/tree-layout";

interface Options {
  /** Opens the occurrence editor on a node; reports whether it could. */
  openEditor: (node: MindmapNode) => boolean;
  /** Writes an occurrence's status through the completion guard. */
  setOccurrenceStatus: (node: MindmapNode, status: string | null) => void;
  /** Archives a selection of occurrences by hand — what `Delete` on them does. */
  archiveOccurrences: (nodes: MindmapNode[]) => boolean;
  toggleCollapsed: (nodeId: string) => void;
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * Runs one entry of a Habit occurrence's context menu. Each write is its own command and so its own
 * undo step; the editor-opening entries write nothing until the editor saves.
 */
export function useOccurrenceMenu({
  openEditor, setOccurrenceStatus, archiveOccurrences, toggleCollapsed, reload, showToast,
}: Options): (node: MindmapNode, action: OccurrenceMenuAction) => void {
  const { t } = useTranslation("warnings");

  const write = useCallback(
    (node: MindmapNode, run: () => Promise<void>) => {
      void run()
        .then(() => reload())
        .catch((error: unknown) => {
          showToast({ nodeId: node.id, message: t("occurrenceActionFailed", { message: getErrorMessage(error) }) });
        });
    },
    [reload, showToast, t],
  );

  return useCallback(
    (node: MindmapNode, action: OccurrenceMenuAction) => {
      if (action.startsWith("status:")) {
        const status = action.slice("status:".length);
        if (isOccurrenceStatus(status)) setOccurrenceStatus(node, storedOccurrenceStatus(status));
        return;
      }
      const key = editableOccurrence(node);
      const plan = (next: PlanOverride) => {
        if (key !== null) write(node, () => setHabitInstancePlan(key, next));
      };
      switch (action) {
        case "edit": case "plan": openEditor(node); break;
        case "follow-cycle-plan": plan({ kind: "inherit" }); break;
        case "unplan": plan({ kind: "unplanned" }); break;
        case "archive": archiveOccurrences([node]); break;
        case "unarchive": if (key !== null) write(node, () => setHabitInstanceArchived(key, false)); break;
        case "collapse": case "expand": toggleCollapsed(node.id); break;
        default: break;
      }
    },
    [openEditor, setOccurrenceStatus, archiveOccurrences, toggleCollapsed, write],
  );
}

function isOccurrenceStatus(value: string): value is OccurrenceStatus {
  return ["todo", "in_progress", "done", "active", "achieved"].includes(value);
}
