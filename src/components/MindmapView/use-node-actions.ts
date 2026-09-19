import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode, findParent, collectAllNodeIds } from "@/utils/mindmap-tree";
import { isValidDropTarget, validParentKinds } from "@/utils/node-meta";
import type { TypedChildKind } from "@/utils/node-meta";
import { updateTask } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { setHabitItemStatus } from "@/api/flows";
import { TASK_STATUS, GOAL_STATUS } from "@/utils/status-mapping";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";
import { getErrorMessage } from "@/api/errors";

const LOG_PREFIX = "[arlesh]";

function nextTaskStatus(current: string): string {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

interface ClipboardEntry {
  operation: "cut" | "copy";
  nodeIds: string[];
}

interface Options {
  tree: MindmapNode;
  clipboard: ClipboardEntry | null;
  moveNode: (id: string, kind: NodeKind, parentId: string, parentKind: NodeKind, position: number) => Promise<void>;
  duplicateNode: (id: string, kind: NodeKind, targetId: string, targetKind: NodeKind, position: number) => Promise<void>;
  onRequestDelete: (nodeIds: string[]) => void;
  reload: () => Promise<void>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  createNode: (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string) => Promise<MindmapNode>;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  selectNode: (id: string | null) => void;
  setClipboard: (entry: ClipboardEntry | null) => void;
  setEditingNodeId: (id: string | null) => void;
  showToast: (toast: { nodeId: string; message: string }) => void;
  /**
   * Opens a blank Flow editor under a parent. A Flow is configured before it exists — instance
   * type, window, duration — so Shift+F opens that editor instead of creating a row to rename.
   */
  onNewFlow: (parentId: string) => void;
}

interface Result {
  onStatusClick: (nodeId: string) => void;
  onCommitEdit: (nodeId: string, title: string) => void;
  onCreateChild: (nodeId: string) => void;
  onCreateTypedChild: (nodeId: string, childKind: TypedChildKind) => void;
  onCreateSibling: (nodeId: string) => void;
  onInsertParent: (nodeId: string) => void;
  onDelete: (nodeIds: string[]) => void;
  onPaste: (targetId: string) => void;
}

export function useNodeActions({
  tree, clipboard, moveNode, duplicateNode, onRequestDelete, reload, renameNode,
  createNode, createChild, selectNode, setClipboard, setEditingNodeId, showToast, onNewFlow,
}: Options): Result {
  const { t } = useTranslation(["warnings", "nodeKinds"]);

  const onStatusClick = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      // A virtual Habit instance (an item, or the iteration root `flow_root`) advances just itself: a
      // goal toggles achieved; a task cycles todo → in_progress → done. `null` clears the Modification
      // (back to the base status). A goal's "achieved" is stored canonically as `done`.
      //
      // A commitment iteration is excluded: it is kept or broken, never advanced, and its two
      // verdict controls live in List View beside every other commitment's. Like a real Commitment,
      // it has no status control on the canvas at all.
      if (node.habitItem !== undefined && node.kind !== "commitment") {
        const { flowId, itemType, itemId, scopeId } = node.habitItem;
        let next: string | null;
        if (node.kind === "goal") {
          next = node.status === GOAL_STATUS.ACHIEVED ? null : TASK_STATUS.DONE;
        } else {
          const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
          next = cycled === TASK_STATUS.TODO ? null : cycled;
        }
        void setHabitItemStatus(flowId, itemType, itemId, scopeId, next, Date.now())
          .then(() => reload())
          .catch((err: unknown) => console.error(`${LOG_PREFIX} habit item status failed:`, err));
        return;
      }
      // A real goal toggles active ↔ achieved on click (like a habit goal instance) — no modal needed.
      if (node.kind === "goal") {
        const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        void updateGoal(dbId, { status: next })
          .then(() => reload())
          .catch((err: unknown) => console.error(`${LOG_PREFIX} goal status toggle failed:`, err));
        return;
      }
      if (node.kind !== "task") return;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) })
        .then(() => reload())
        .catch((err: unknown) => console.error(`${LOG_PREFIX} status cycle failed:`, err));
    },
    [tree, reload],
  );

  const onCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") { setEditingNodeId(null); return; }
      const node = findNode(tree, nodeId);
      if (node !== undefined) {
        void renameNode(nodeId, node.kind, title.trim()).then(() => setEditingNodeId(null));
      }
    },
    [tree, renameNode, setEditingNodeId],
  );

  const onCreateChild = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || !nodeId.includes("-") || node.kind === "tag") return;
      void (async () => {
        try {
          const newNode = await createChild(nodeId, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} createChild failed:`, err);
        }
      })();
    },
    [tree, createChild, selectNode, setEditingNodeId],
  );

  const onCreateTypedChild = useCallback(
    (nodeId: string, childKind: TypedChildKind) => {
      const parent = findNode(tree, nodeId);
      // The synthetic root has no row behind it to hang anything from.
      if (parent === undefined || !nodeId.includes("-")) return;

      // Refused, not relocated: putting the node somewhere other than where the user pointed is
      // worse than not creating it — and saying nothing would read as a broken key. The message
      // states the rule positively, so it answers "then where?" in the same breath.
      if (!isValidDropTarget(childKind, parent.kind)) {
        showToast({
          nodeId,
          message: t("warnings:typedChildRefused", {
            child: t(`nodeKinds:${childKind}`),
            parent: t(`nodeKinds:${parent.kind}`),
            parents: validParentKinds(childKind).map((kind) => t(`nodeKinds:${kind}`)).join(", "),
          }),
        });
        return;
      }

      if (childKind === "flow") { onNewFlow(nodeId); return; }

      void (async () => {
        try {
          const newNode = await createNode(nodeId, parent.kind, childKind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          // The backend has parenting rules of its own, and a chord that asks for something it
          // refuses must still say so: an inert key is exactly what this feature exists to avoid.
          console.error(`${LOG_PREFIX} createTypedChild failed:`, err);
          showToast({ nodeId, message: t("warnings:createFailed", { message: getErrorMessage(err) }) });
        }
      })();
    },
    [tree, createNode, onNewFlow, selectNode, setEditingNodeId, showToast, t],
  );

  const onDelete = useCallback(
    (nodeIds: string[]) => {
      const valid = nodeIds.filter((id) => {
        const node = findNode(tree, id);
        return node !== undefined && node.kind !== "aspect";
      });
      if (valid.length > 0) onRequestDelete(valid);
    },
    [tree, onRequestDelete],
  );

  const onPaste = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const targetNode = findNode(tree, targetId);
      if (targetNode === undefined) return;
      const isCopy = clipboard.operation === CLIPBOARD_OP.COPY;

      // A node is pasteable here if drag-and-drop would allow the same reparent (e.g. aspects are
      // fixed and can't be reparented) and it isn't a derived, DB-less virtual node. A COPY refuses
      // a Flow, a flow item or a Commitment on top of that: none of them has a duplicate command.
      // A Commitment's would have to decide what a copy of a recorded Verdict means, which nobody
      // has. Refused here rather than in `duplicateNode` so it is *said* — the skipped-paste toast
      // names the count, instead of the copy failing where nothing is watching.
      const nodeIds = clipboard.nodeIds.filter((id) => {
        const node = findNode(tree, id);
        if (node === undefined || node.virtual === true) return false;
        if (!isValidDropTarget(node.kind, targetNode.kind)) return false;
        if (isCopy && (node.kind === "flow" || node.kind === "flow_goal" || node.kind === "flow_task")) return false;
        if (isCopy && node.kind === "commitment") return false;
        return true;
      });
      const skippedCount = clipboard.nodeIds.length - nodeIds.length;
      if (skippedCount > 0) {
        showToast({ nodeId: targetId, message: t("pasteSkipped", { count: skippedCount }) });
      }
      if (nodeIds.length === 0) return;
      const selectedSet = new Set(nodeIds);

      // Keep only top-level nodes (no ancestor in the selected set)
      const topLevel = nodeIds.filter((id) => {
        let parent = findParent(tree, id);
        while (parent !== null) {
          if (selectedSet.has(parent.id)) return false;
          parent = findParent(tree, parent.id);
        }
        return true;
      });

      // Sort by tree pre-order so relative order is preserved
      const treeOrder = collectAllNodeIds(tree);
      topLevel.sort((a, b) => treeOrder.indexOf(a) - treeOrder.indexOf(b));

      const basePosition =
        targetNode.children.length > 0
          ? Math.max(...targetNode.children.map((c) => c.position)) + 1
          : 0;

      void (async () => {
        for (let i = 0; i < topLevel.length; i++) {
          const nodeId = topLevel[i]!;
          const sourceNode = findNode(tree, nodeId);
          if (sourceNode === undefined) continue;
          if (isCopy) {
            await duplicateNode(nodeId, sourceNode.kind, targetId, targetNode.kind, basePosition + i);
          } else {
            await moveNode(nodeId, sourceNode.kind, targetId, targetNode.kind, basePosition + i);
          }
        }
        if (!isCopy) setClipboard(null);
      })();
    },
    [clipboard, tree, moveNode, duplicateNode, setClipboard, showToast, t],
  );

  const onCreateSibling = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const parent = findParent(tree, nodeId);
      if (parent === null || parent.id === "root") return;
      void (async () => {
        try {
          const newNode = await createNode(parent.id, parent.kind, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} createSibling failed:`, err);
        }
      })();
    },
    [tree, createNode, selectNode, setEditingNodeId],
  );

  const onInsertParent = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const parent = findParent(tree, nodeId);
      if (parent === null || parent.id === "root") return;
      void (async () => {
        try {
          const newNode = await createChild(parent.id, parent.kind, "");
          await moveNode(nodeId, node.kind, newNode.id, newNode.kind, 0);
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} insertParent failed:`, err);
        }
      })();
    },
    [tree, createChild, moveNode, selectNode, setEditingNodeId],
  );

  return { onStatusClick, onCommitEdit, onCreateChild, onCreateTypedChild, onCreateSibling, onInsertParent, onDelete, onPaste };
}
