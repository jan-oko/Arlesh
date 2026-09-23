import { useCallback } from "react";
import { isOccurrence } from "@/utils/node-identity";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { EditorModalState } from "@/components/MindmapView/use-node-editor";

/**
 * `Shift+W` on a Task: open its editor at the **Expectation** section, with Asynchronous switched
 * on — the one-press way to say what finishing the Task will be waiting on. Nothing is written
 * until the editor is saved, so Cancel leaves the Task exactly as it was. Anything but a real Task
 * is refused out loud.
 */
export function useOpenAsyncTemplate(
  tree: MindmapNode,
  setEditorModal: (state: EditorModalState | null) => void,
): (nodeId: string) => void {
  const { t } = useTranslation("expectation");
  const showToast = useMindmapStore((s) => s.showToast);
  return useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      if (node.kind !== "task" || node.rowId === undefined || isOccurrence(node)) {
        showToast({ nodeId, message: t("bindNotATask") });
        return;
      }
      setEditorModal({ nodeId, node, focus: "asyncTemplate" });
    },
    [tree, setEditorModal, showToast, t],
  );
}
