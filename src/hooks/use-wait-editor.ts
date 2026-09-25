import { useCallback, useState } from "react";
import type { RowId } from "@/api/node-id";
import { dayStartInstant } from "@/utils/scope-calendar";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { addTagToExpectation, createExpectation, updateExpectation } from "@/api/expectations";
import { EXPECTATION_ARCHIVAL, EXPECTATION_STATUS } from "@/api/expectation-status";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import { withAtomicGesture } from "@/api/gesture";

/** Where a new stored wait will hang — `Shift+E` in the List View. */
export interface ExpectationCreate {
  parentType: string;
  parentId: RowId;
}

/** The `parent_type` a child of `parent` is written with — the spelling a Task's link takes. */
function parentTypeOf(parent: MindmapNode): string {
  if (parent.kind === "goal" || parent.kind === "task" || parent.kind === "commitment") return parent.kind;
  return "project";
}

/**
 * The editor `Shift+E` opens in the List View: a new **stored** Expectation under the selected row.
 * (A row has no inline title to fill, so the wait is configured before it exists.)
 */
export function useWaitEditor(tree: MindmapNode, reload: () => Promise<void>) {
  const [create, setCreate] = useState<ExpectationCreate | null>(null);

  const dismiss = useCallback(() => setCreate(null), []);

  /** `Shift+E` in the List View: open the editor for a wait under `nodeId`. The caller has already
   * checked that the node can hold one. */
  const createUnder = useCallback(
    (nodeId: string) => {
      const parent = findNode(tree, nodeId);
      if (parent === undefined || parent.rowId === undefined) return;
      setCreate({ parentType: parentTypeOf(parent), parentId: parent.rowId });
    },
    [tree],
  );

  const saveCreate = useCallback(
    async (gestureName: string, data: ExpectationSaveData) => {
      if (create === null) return;
      await withAtomicGesture(gestureName, async () => {
        const wait = await createExpectation({
          title: data.title,
          parent_type: create.parentType,
          parent_id: create.parentId,
          ...(data.checkEvery !== null ? { check_every: data.checkEvery } : {}),
          ...(data.checkEvery !== null && data.checkStartingDate !== null
            ? { check_starting: dayStartInstant(data.checkStartingDate) } : {}),
          ...(data.timeScope !== null ? { time_scope: data.timeScope } : {}),
          ...(data.agentic ? { agentic: true } : {}),
          ...(data.agenticNote !== null ? { agentic_note: data.agenticNote } : {}),
        });
        // What the create request has no field for is written straight after, inside the same
        // Gesture — only when the editor says something other than the defaults.
        if (data.isPrivate || data.archived || data.status !== EXPECTATION_STATUS.PENDING) {
          await updateExpectation(wait.id, {
            is_private: data.isPrivate,
            status: data.status,
            archival: data.archived ? EXPECTATION_ARCHIVAL.ARCHIVED : EXPECTATION_ARCHIVAL.LIVE,
          });
        }
        for (const tagId of data.tagIds) await addTagToExpectation(wait.id, tagId);
      });
      setCreate(null);
      await reload();
    },
    [create, reload],
  );

  return { create, dismiss, saveCreate, createUnder };
}
