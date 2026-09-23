import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { canParentNewTask, validParentKinds } from "@/utils/node-meta";
import type { TaskAgentic } from "@/api/tasks";
import { getErrorMessage } from "@/api/errors";

const LOG_PREFIX = "[arlesh]";

interface Options {
  /** Posts a blank To Do Task under a parent, and answers with the node the reload gave it.
   * `agentic` seeds the new Task's own flag, for the sibling that carries one over. */
  createTask: (parentId: string, parentKind: NodeKind, agentic?: TaskAgentic) => Promise<MindmapNode>;
  /** Removes a Task — how a create abandoned before it was ever named costs nothing. */
  deleteTask: (id: string) => Promise<void>;
  renameTask: (id: string, title: string) => Promise<void>;
  /** Moves the list's selection, so the new row is the one the keyboard is standing on. */
  selectRow: (id: string) => void;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

interface ListCreate {
  /** The row whose title is open for inline editing, if any. */
  editingTaskId: string | null;
  /** Opens an existing row's title for editing — the `R` chord. */
  startRename: (id: string) => void;
  /** Creates a To Do Task under `parent`, selects it, and opens its title for naming. */
  createTaskUnder: (parent: MindmapNode, agentic?: TaskAgentic) => void;
  /** Enter or blur: writes the title, or discards a Task that never got one. */
  commitTitle: (id: string, title: string) => void;
  /** Escape: closes the editor, and discards the Task if this was its first naming. */
  cancelTitleEdit: () => void;
}

/**
 * Naming a row in List View, including the first naming of one that has just been created.
 *
 * The two belong together because Escape means different things to them: on a row that already has
 * a title it abandons an edit, and on one that has never had a title it abandons the **Task** — a
 * mistaken create costs nothing, which it could not promise if the create and the naming were
 * tracked apart. `editingTaskId` and the unnamed Task are kept in lockstep: there is at most one
 * row being named, and it is the new one exactly while a create is still unanswered.
 *
 * Nothing here decides *where* a Task goes. The caller resolves the parent from the selected row
 * (its own parent for a sibling, itself for a child) or from a path header's last segment, and
 * hands over the node; this hook only refuses the parents that could never hold a Task and says
 * why, so no gesture is ever silently inert.
 */
export function useListCreate({
  createTask, deleteTask, renameTask, selectRow, showToast,
}: Options): ListCreate {
  const { t } = useTranslation(["warnings", "nodeKinds"]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [unnamedTaskId, setUnnamedTaskId] = useState<string | null>(null);

  const discard = useCallback(
    (id: string) => {
      void deleteTask(id).catch((err: unknown) => {
        console.error(`${LOG_PREFIX} discarding a new task failed:`, err);
        showToast({ nodeId: id, message: t("warnings:deleteFailed", { message: getErrorMessage(err) }) });
      });
    },
    [deleteTask, showToast, t],
  );

  const startRename = useCallback((id: string) => {
    setUnnamedTaskId(null);
    setEditingTaskId(id);
  }, []);

  const createTaskUnder = useCallback(
    (parent: MindmapNode, agentic?: TaskAgentic) => {
      // Refused out loud rather than relocated or ignored, on the Mindmap's rule: putting the Task
      // somewhere other than where it was asked for is worse than not creating it, and saying
      // nothing would read as a broken key.
      // A virtual node — a collapsed run of passed iterations — is drawn, not stored, and is
      // nobody's parent. An **occurrence** is a row: it holds children of its own, attached to
      // that iteration alone, and takes them through the same gesture as anything else.
      if (parent.virtual === true) {
        showToast({ nodeId: parent.id, message: t("warnings:createUnderRepetition") });
        return;
      }
      if (!canParentNewTask(parent)) {
        showToast({
          nodeId: parent.id,
          message: t("warnings:typedChildRefused", {
            child: t("nodeKinds:task"),
            parent: t(`nodeKinds:${parent.kind}`),
            parents: validParentKinds("task").map((kind) => t(`nodeKinds:${kind}`)).join(", "),
          }),
        });
        return;
      }
      void (async () => {
        try {
          const created = await createTask(parent.id, parent.kind, agentic);
          selectRow(created.id);
          setUnnamedTaskId(created.id);
          setEditingTaskId(created.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} create task failed:`, err);
          showToast({ nodeId: parent.id, message: t("warnings:createFailed", { message: getErrorMessage(err) }) });
        }
      })();
    },
    [createTask, selectRow, showToast, t],
  );

  const commitTitle = useCallback(
    (id: string, title: string) => {
      const wasUnnamed = id === unnamedTaskId;
      setEditingTaskId(null);
      setUnnamedTaskId(null);
      const trimmed = title.trim();
      if (trimmed !== "") {
        void renameTask(id, trimmed);
        return;
      }
      // An empty title costs the same as Escape on a Task that never had one: blank is not a name,
      // and a nameless row left on the board would be the create the user walked away from. An
      // existing row simply keeps the title it already has.
      if (wasUnnamed) discard(id);
    },
    [discard, renameTask, unnamedTaskId],
  );

  const cancelTitleEdit = useCallback(() => {
    const abandoned = unnamedTaskId;
    setEditingTaskId(null);
    setUnnamedTaskId(null);
    if (abandoned !== null) discard(abandoned);
  }, [discard, unnamedTaskId]);

  return { editingTaskId, startRename, createTaskUnder, commitTitle, cancelTitleEdit };
}
