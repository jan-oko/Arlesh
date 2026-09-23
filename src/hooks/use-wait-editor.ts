import { useCallback, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { addTagToExpectation, createExpectation, updateExpectation } from "@/api/expectations";
import { EXPECTATION_ARCHIVAL, EXPECTATION_STATUS } from "@/api/expectation-status";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import type { AsyncTemplate } from "@/api/tasks";
import { updateTask } from "@/api/tasks";
import { withAtomicGesture } from "@/api/gesture";

/** Where a new stored wait will hang — `Shift+E` in the List View. */
export interface ExpectationCreate {
  parentType: string;
  parentId: number;
}

/** The Task whose Expectation template `Shift+W` is editing. */
export interface TemplateEdit {
  taskId: number;
  taskTitle: string;
  /** The Task's template, or `null` when it is not asynchronous yet. */
  template: AsyncTemplate | null;
}

/** The `parent_type` a child of `parent` is written with — the spelling a Task's link takes. */
function parentTypeOf(parent: MindmapNode): string {
  if (parent.kind === "goal" || parent.kind === "task" || parent.kind === "commitment") return parent.kind;
  return "project";
}

/** The template a Task that has none starts from: the one the migration and bare `W` write. */
export function defaultTemplate(taskTitle: string, title: (task: string) => string): AsyncTemplate {
  return { title: title(taskTitle), tag_ids: [] };
}

/**
 * The two editors a view opens for waits:
 *
 * - **`Shift+W`** on a Task edits its **Expectation template** — the wait finishing the Task will
 *   spawn. Saving writes the template (or, removed, makes the Task not asynchronous); it never
 *   creates an Expectation.
 * - **`Shift+E`** in the List View creates a **stored** Expectation under the selected row.
 */
export function useWaitEditor(tree: MindmapNode, reload: () => Promise<void>) {
  const { t } = useTranslation("expectation");
  const showToast = useMindmapStore((s) => s.showToast);
  const [create, setCreate] = useState<ExpectationCreate | null>(null);
  const [template, setTemplate] = useState<TemplateEdit | null>(null);

  const dismiss = useCallback(() => { setCreate(null); setTemplate(null); }, []);

  /** `Shift+W`: open the template editor on a real Task, and refuse anything else out loud. */
  const bind = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      if (node.kind !== "task" || node.rowId === undefined || node.habitItem !== undefined) {
        showToast({ nodeId, message: t("bindNotATask") });
        return;
      }
      setTemplate({ taskId: node.rowId, taskTitle: node.title, template: node.asyncTemplate ?? null });
    },
    [tree, showToast, t],
  );

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

  const saveTemplate = useCallback(
    async (gestureName: string, next: AsyncTemplate | null) => {
      if (template === null) return;
      await withAtomicGesture(gestureName, () => updateTask(template.taskId, { async_template: next }));
      setTemplate(null);
      await reload();
    },
    [template, reload],
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
            ? { check_starting: `${data.checkStartingDate}T00:00:00` } : {}),
          ...(data.timeScope !== null ? { time_scope: data.timeScope } : {}),
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

  return { create, template, dismiss, saveCreate, saveTemplate, bind, createUnder };
}
