import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode, findParent, collectAllNodeIds } from "@/utils/mindmap-tree";
import { isValidDropTarget, validParentKinds } from "@/utils/node-meta";
import { pasteRefusal, countPasteRefusals, pasteRefusalKey, PASTE_REFUSAL } from "@/utils/paste-refusal";
import type { PasteRefusal, PasteRefusalCount } from "@/utils/paste-refusal";
import type { TypedChildKind } from "@/utils/node-meta";
import { updateTask } from "@/api/tasks";
import type { TaskAgentic } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import { updateGoal } from "@/api/goals";
import { setHabitItemStatus } from "@/api/flows";
import { TASK_STATUS, GOAL_STATUS } from "@/utils/status-mapping";
import { CLIPBOARD_OP } from "@/stores/use-clipboard-store";
import { withGesture } from "@/api/gesture";
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
  /** `agentic` seeds a new Task's own flag; omitted, it starts in Inherit. */
  createNode: (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string, agentic?: TaskAgentic) => Promise<MindmapNode>;
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
  /**
   * Opens the Commitment editor on a blank commitment under `parentId`. A Commitment is invalid
   * without a window of its own or one above it, so Shift+C asks for the window first rather than
   * posting a bare row for the backend to refuse.
   */
  onNewCommitment: (parentId: string) => void;
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
  createNode, createChild, selectNode, setClipboard, setEditingNodeId, showToast, onNewFlow, onNewCommitment,
}: Options): Result {
  const { t } = useTranslation(["warnings", "nodeKinds", "undo"]);

  const onStatusClick = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      // A virtual Habit instance (an item, or the iteration root `flow_root`) advances just itself: a
      // goal toggles achieved; a task cycles todo → in_progress → done. `null` clears the Modification
      // (back to the base status). A goal's "achieved" is stored canonically as `done`.
      //
      // A commitment iteration is excluded: it is kept or broken, never advanced. Like a real
      // Commitment it has no status control to click on the canvas — the tick and the cross are
      // List View's — but the canvas is not silent about it either: Enter cycles its verdict and X
      // records Broken, both through `useCommitmentVerdict`, which writes an iteration's verdict as
      // its Modification exactly as this branch writes an ordinary instance's status.
      if (node.habitItem !== undefined && node.kind !== "commitment") {
        const { flowId, itemType, itemId, scopeId, cycleId } = node.habitItem;
        let next: string | null;
        if (node.kind === "goal") {
          next = node.status === GOAL_STATUS.ACHIEVED ? null : TASK_STATUS.DONE;
        } else {
          const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
          next = cycled === TASK_STATUS.TODO ? null : cycled;
        }
        void setHabitItemStatus(flowId, itemType, itemId, scopeId, cycleId, next, Date.now())
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

      // Two kinds are configured before they exist rather than named and filled in after. A Flow
      // because that is what a Flow is; a Commitment because it is not valid without a window, so
      // posting a bare row first would only earn a refusal and leave the user at a dead end.
      if (childKind === "flow") { onNewFlow(nodeId); return; }
      if (childKind === "commitment") { onNewCommitment(nodeId); return; }

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
    [tree, createNode, onNewFlow, onNewCommitment, selectNode, setEditingNodeId, showToast, t],
  );

  const onDelete = useCallback(
    (nodeIds: string[]) => {
      const nodes = nodeIds
        .map((id) => findNode(tree, id))
        .filter((node): node is MindmapNode => node !== undefined);

      // A virtual Habit repetition is derived at load time, so there is no row to delete — and the
      // Habit's template behind it is emphatically not what `Delete` on one occurrence should take
      // away. It is refused here, in the List View's words (`useListDelete` raises the same key),
      // because one gesture on one kind of node must not read two ways depending on the surface.
      // Refusing this early is the whole point: the guard used to stop at `kind !== "aspect"`, so a
      // repetition raised the confirmation and then reached `dbIdFromNodeId`, which rejects the
      // `-virtual` tail — the user answered a dialog that could only end in "delete failed".
      //
      // One repetition anywhere in the selection refuses the **whole** gesture, rather than taking
      // the real nodes and naming what was skipped the way `onPaste` does. Two reasons, and the
      // second decides it. A delete is destructive where a paste is additive, so acting on half of
      // a selection the user did not mean costs data rather than a stray copy. And the notice would
      // not be read: it is a viewport toast that fades after three seconds, and confirming a delete
      // puts the modal's overlay over the top of it — "deleted the rest, mentioned the skip" would
      // be a silent skip wearing a message, which is the thing the rule exists to forbid.
      const repetition = nodes.find((node) => node.virtual === true);
      if (repetition !== undefined) {
        showToast({ nodeId: repetition.id, message: t("warnings:deleteRepetitionRefused") });
        return;
      }

      const valid = nodes.filter((node) => node.kind !== "aspect");
      if (valid.length > 0) onRequestDelete(valid.map((node) => node.id));
    },
    [tree, onRequestDelete, showToast, t],
  );

  /**
   * One refusal line, as a sentence.
   *
   * A refusal about the node reads the same however it arose, so it takes the count alone. The
   * destination refusal is the one that has to be built, because it is the only one that used to
   * say nothing: it names the kind that was refused, what it was dropped on, and — from
   * `validParentKinds`, which is the drop rule read the other way round — where it would have gone.
   * The count's noun is the kind itself, whose plural comes from `nodeKinds`, which is why the
   * frame in `warnings` needs no plural of its own.
   */
  const refusalSentence = useCallback(
    (line: PasteRefusalCount, parentKind: NodeKind): string => {
      const key = pasteRefusalKey(line);
      if (line.reason !== PASTE_REFUSAL.HERE) return t(key, { count: line.count });
      return t(key, {
        count: line.count,
        child: t(`nodeKinds:${line.child}`, { count: line.count }),
        parent: t(`nodeKinds:${parentKind}`),
        parents: line.validParents.map((kind) => t(`nodeKinds:${kind}`)).join(", "),
      });
    },
    [t],
  );

  const onPaste = useCallback(
    (targetId: string) => {
      if (clipboard === null) return;
      const targetNode = findNode(tree, targetId);
      if (targetNode === undefined) return;
      const isCopy = clipboard.operation === CLIPBOARD_OP.COPY;

      // Every reason a node is left behind lives in `pasteRefusal`, which the drag-and-drop rule is
      // only one of: an Aspect is fixed wherever you point, a Habit repetition has no row behind it
      // to copy, a Commitment has no duplicate at all (what a copy of a recorded Verdict means has
      // never been decided), and a flow item's Cycle Scope is an offset into its own Flow's window,
      // which another Flow's does not share. Refused here rather than in `duplicateNode` so each one
      // is *said*, instead of the copy failing where nothing is watching.
      const refusals: PasteRefusal[] = [];
      const nodeIds = clipboard.nodeIds.filter((id) => {
        const refusal = pasteRefusal(tree, id, targetNode, isCopy);
        if (refusal === null) return true;
        refusals.push(refusal);
        return false;
      });
      // One toast carrying every reason, never one call per reason: the store holds a single pending
      // toast, so a second `showToast` would overwrite the first and the node it spoke for would be
      // dropped in silence — exactly what this message exists to prevent.
      if (refusals.length > 0) {
        const message = countPasteRefusals(refusals)
          .map((line) => refusalSentence(line, targetNode.kind))
          .join(" ");
        showToast({ nodeId: targetId, message });
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

      // One Gesture around every write the paste makes, so five pasted nodes are one Ctrl+Z rather
      // than five. This is the run the whole granularity design exists for.
      const label = isCopy
        ? t("undo:gestures.paste", { count: topLevel.length })
        : t("undo:gestures.move", { count: topLevel.length });
      void withGesture(label, async () => {
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
      }).catch((err: unknown) => {
        console.error(`${LOG_PREFIX} paste failed:`, err);
      });
    },
    [clipboard, tree, moveNode, duplicateNode, setClipboard, showToast, refusalSentence, t],
  );

  const onCreateSibling = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      const parent = findParent(tree, nodeId);
      if (parent === null || parent.id === "root") return;
      // The sibling carries over the source Task's **own stored** Agentic flag. Sharing a parent
      // already gives it whatever that parent has; what it would otherwise lose is the answer the
      // source gave itself, so a Task you deliberately marked agentic used to produce a sibling
      // that was not.
      //
      // The stored column, never `isAgentic`'s resolved value: copying what the source *reads as*
      // would freeze an inherited "yes" into an explicit one on the sibling, quietly cutting it
      // off from the ancestor that was deciding for it. An unset source stays unset here.
      const agentic = node.kind === "task" ? storedAgenticState(node.agentic) : undefined;
      void (async () => {
        try {
          const newNode = await createNode(parent.id, parent.kind, node.kind, "", agentic);
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
      // Two writes — the new parent, then the move under it. Without a Gesture, undoing would take
      // back the move and leave an empty node behind.
      void (async () => {
        try {
          await withGesture(t("undo:gestures.insertParent"), async () => {
            const newNode = await createChild(parent.id, parent.kind, "");
            await moveNode(nodeId, node.kind, newNode.id, newNode.kind, 0);
            selectNode(newNode.id);
            setEditingNodeId(newNode.id);
          });
        } catch (err) {
          console.error(`${LOG_PREFIX} insertParent failed:`, err);
        }
      })();
    },
    [tree, createChild, moveNode, selectNode, setEditingNodeId, t],
  );

  return { onStatusClick, onCommitEdit, onCreateChild, onCreateTypedChild, onCreateSibling, onInsertParent, onDelete, onPaste };
}
