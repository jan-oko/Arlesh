import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode, findParent, collectAllNodeIds } from "@/utils/mindmap-tree";
import { canAdoptChildren, canParentAnyNewChild, canParentNewChild, validParentKinds } from "@/utils/node-meta";
import { pasteRefusal, countPasteRefusals, pasteRefusalKey, flowsLeftBehind, PASTE_REFUSAL } from "@/utils/paste-refusal";
import type { PasteRefusal, PasteRefusalCount } from "@/utils/paste-refusal";
import type { TypedChildKind } from "@/utils/node-meta";
import { updateTask } from "@/api/tasks";
import type { TaskAgentic } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import { updateGoal } from "@/api/goals";
import { TASK_STATUS, GOAL_STATUS } from "@/utils/status-mapping";
import { CLIPBOARD_OP } from "@/stores/use-clipboard-store";
import { withGesture } from "@/api/gesture";
import { getErrorMessage } from "@/api/errors";
import { useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";

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
  /** The occurrence completion the backend is holding for confirmation, or `null`. */
  occurrencePrompt: OccurrencePrompt | null;
  /** Answers that prompt: marks the occurrence done and leaves its children in place. */
  confirmOccurrence: () => void;
  /** Declines it. Nothing was written, so nothing is undone. */
  cancelOccurrence: () => void;
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
  const { prompt: occurrencePrompt, setOccurrenceStatus, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion(reload);

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
        let next: string | null;
        if (node.kind === "goal") {
          next = node.status === GOAL_STATUS.ACHIEVED ? null : TASK_STATUS.DONE;
        } else {
          const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
          next = cycled === TASK_STATUS.TODO ? null : cycled;
        }
        // Through the completion guard: marking an occurrence done while it still holds
        // unfinished added children asks first, and names them.
        setOccurrenceStatus(node, next);
        return;
      }
      // A real goal toggles active ↔ achieved on click (like a habit goal instance) — no modal needed.
      if (node.kind === "goal") {
        const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
        const next = node.status === GOAL_STATUS.ACHIEVED ? GOAL_STATUS.ACTIVE : GOAL_STATUS.ACHIEVED;
        void updateGoal(dbId, { status: next })
          .then(() => reload())
          .catch((err: unknown) => {
            console.error(`${LOG_PREFIX} goal status toggle failed:`, err);
            showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
          });
        return;
      }
      if (node.kind !== "task") return;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) })
        .then(() => reload())
        .catch((err: unknown) => {
          console.error(`${LOG_PREFIX} status cycle failed:`, err);
          showToast({ nodeId, message: t("warnings:statusChangeFailed", { message: getErrorMessage(err) }) });
        });
    },
    [tree, reload, setOccurrenceStatus, showToast, t],
  );

  const onCommitEdit = useCallback(
    (nodeId: string, title: string) => {
      if (title.trim() === "") { setEditingNodeId(null); return; }
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      void renameNode(nodeId, node.kind, title.trim())
        .then(() => setEditingNodeId(null))
        .catch((err: unknown) => {
          // The rename stays open on the title that earned the refusal, rather than closing on a
          // write that did not happen. Before this, a refused rename left the old title on the
          // canvas and said nothing — indistinguishable from a rename that worked and was undone.
          console.error(`${LOG_PREFIX} rename failed:`, err);
          showToast({ nodeId, message: t("warnings:renameFailed", { message: getErrorMessage(err) }) });
        });
    },
    [tree, renameNode, setEditingNodeId, showToast, t],
  );

  const onCreateChild = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      // The synthetic root is the "nothing was aimed at" case, and stays silent on purpose — the
      // same answer the typed chords give with no selection at all.
      if (node === undefined || !nodeId.includes("-")) return;
      // `Tab` names no kind — the parent decides what its child is — so the question it can ask is
      // whether this node holds anything at all. Exactly two answers are no: a Tag, which is a
      // label rather than a container, and a node drawn rather than stored (a folded run of Habit
      // history). Both used to be an `if (…) return` with nothing on screen.
      if (!canParentAnyNewChild(node)) {
        showToast({
          nodeId,
          message: node.kind === "tag"
            ? t("warnings:createUnderTagRefused")
            : t("warnings:createUnderRepetition"),
        });
        return;
      }
      void (async () => {
        try {
          const newNode = await createChild(nodeId, node.kind, "");
          selectNode(newNode.id);
          setEditingNodeId(newNode.id);
        } catch (err) {
          console.error(`${LOG_PREFIX} createChild failed:`, err);
          showToast({ nodeId, message: t("warnings:createFailed", { message: getErrorMessage(err) }) });
        }
      })();
    },
    [tree, createChild, selectNode, setEditingNodeId, showToast, t],
  );

  /**
   * Why `parent` cannot take a new `childKind`, as a sentence.
   *
   * Three refusals, because three different things are wrong and a user sent to fix the wrong one
   * is worse off than one told nothing. A **folded run of Habit history** is drawn rather than
   * stored, so no kind would have worked and no other parent is being suggested. An **occurrence**
   * does hold children of its own — but only the four its attachment path can write, so a Flow
   * aimed at one is refused for a reason that has nothing to do with where Flows live. Everything
   * else is the ordinary parenting rule, stated positively so it answers "then where?".
   */
  const typedChildRefusal = useCallback(
    (parent: MindmapNode, childKind: TypedChildKind): string => {
      if (parent.habitItem !== undefined) {
        return t("warnings:createUnderOccurrenceRefused", { child: t(`nodeKinds:${childKind}`) });
      }
      if (parent.virtual === true) return t("warnings:createUnderRepetition");
      return t("warnings:typedChildRefused", {
        child: t(`nodeKinds:${childKind}`),
        parent: t(`nodeKinds:${parent.kind}`),
        parents: validParentKinds(childKind).map((kind) => t(`nodeKinds:${kind}`)).join(", "),
      });
    },
    [t],
  );

  const onCreateTypedChild = useCallback(
    (nodeId: string, childKind: TypedChildKind) => {
      const parent = findNode(tree, nodeId);
      // The synthetic root has no row behind it to hang anything from.
      if (parent === undefined || !nodeId.includes("-")) return;

      // Refused, not relocated: putting the node somewhere other than where the user pointed is
      // worse than not creating it — and saying nothing would read as a broken key.
      //
      // Asked of the **node**, not of its kind. A kind cannot tell a real row from a drawing of
      // one, so `Shift+F` on a virtual Habit occurrence used to pass this check (a Habit whose
      // instances are Goals draws an iteration root of kind `goal`, and a Flow may sit under a
      // Goal), route straight to the Flow editor below, and post a parent id of `NaN`.
      if (!canParentNewChild(parent, childKind)) {
        showToast({ nodeId, message: typedChildRefusal(parent, childKind) });
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
    [tree, createNode, onNewFlow, onNewCommitment, selectNode, setEditingNodeId, showToast, t, typedChildRefusal],
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
      //
      // An **Aspect** is the second node this applies to, and the reason it is here rather than
      // quietly filtered out of the delete set: the backend refuses every write to one (`domains`
      // returns `FixedAspect` on update and on delete alike), the six are seeded with the board,
      // and there is no gesture anywhere that removes one. `Delete` on an Aspect alone used to be
      // an inert key — indistinguishable from a dead one — and in a mixed selection it took
      // everything else and said nothing about what it had dropped.
      const refused = nodes.filter((node) => node.virtual === true || node.kind === "aspect");
      const first = refused[0];
      if (first !== undefined) {
        // One toast, both sentences: the store holds a single pending notice, so a selection that
        // trips both rules has to say both at once or say one of them into nothing.
        const messages: string[] = [];
        if (refused.some((node) => node.virtual === true)) messages.push(t("warnings:deleteRepetitionRefused"));
        if (refused.some((node) => node.kind === "aspect")) messages.push(t("warnings:deleteAspectRefused"));
        showToast({ nodeId: first.id, message: messages.join(" ") });
        return;
      }

      if (nodes.length > 0) onRequestDelete(nodes.map((node) => node.id));
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
      // The one line that names rather than counts. The names are assembled here because the list
      // separator and the overflow tail are words, not punctuation the util should be inventing —
      // the same reason the destination refusal joins its parent labels here too.
      if (line.reason === PASTE_REFUSAL.FLOW_UNDER) {
        const flows = line.named.map((title) => t("warnings:pasteSkippedFlowName", { title }));
        if (line.unnamed > 0) flows.push(t("warnings:pasteSkippedFlowMore", { count: line.unnamed }));
        return t(key, { count: line.count, flows: flows.join(", ") });
      }
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

      // The destination is asked first, and as a node. A folded run of Habit history and a virtual
      // occurrence both wear a kind that the drop rule would say yes to, and neither has a row for
      // a moved node's parent link to point at — an occurrence's own children are *attached* to
      // the iteration when they are created, which a move of an existing row cannot do. Refused
      // once here rather than once per clipboard entry: one reason, one sentence.
      if (!canAdoptChildren(targetNode)) {
        showToast({ nodeId: targetId, message: t("warnings:pasteOntoRepetitionRefused") });
        return;
      }
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
      // The skip nothing in the selection hints at: a Flow hanging *under* one of the nodes being
      // copied. The backend's duplication walk does not descend into a Flow, so the pasted subtree
      // comes out quietly smaller than the one that was copied. It leaves `nodeIds` untouched —
      // everything that can be copied still is, and this only says what the copy could not carry.
      // Copies alone: a cut re-points one parent link and the whole subtree follows.
      if (isCopy) refusals.push(...flowsLeftBehind(tree, nodeIds));
      // One toast carrying every reason, never one call per reason: the store holds a single pending
      // toast, so a second `showToast` would overwrite the first and the node it spoke for would be
      // dropped in silence — exactly what this message exists to prevent.
      const skipped = refusals.length === 0
        ? ""
        : countPasteRefusals(refusals)
          .map((line) => refusalSentence(line, targetNode.kind))
          .join(" ");
      if (skipped !== "") showToast({ nodeId: targetId, message: skipped });
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
        // Every refusal the *backend* raises — a CHECK constraint, a cycle, a foreign key — used
        // to reach the user as nothing at all: a board that silently did not change, which is
        // worse than a wrong reason or a generic one.
        //
        // It arrives after the skip notice this same gesture may already have put up, and the
        // store holds one toast. So it replaces that notice only by **containing** it: both
        // sentences, in the order they happened. Nothing the gesture said is taken off screen
        // unsaid, and the timer restarts on a message that now has more to read.
        const failure = t("warnings:pasteFailed", { message: getErrorMessage(err) });
        showToast({ nodeId: targetId, message: skipped === "" ? failure : `${skipped} ${failure}` });
      });
    },
    [clipboard, tree, moveNode, duplicateNode, setClipboard, showToast, refusalSentence, t],
  );

  const onCreateSibling = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      // The six Aspects are seeded with the board and the backend refuses every write to one, so
      // there is no seventh to create alongside this. Said, not skipped: the chord used to be an
      // inert key here, which reads as a broken one.
      if (node.kind === "aspect") {
        showToast({ nodeId, message: t("warnings:siblingAspectRefused") });
        return;
      }
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
          showToast({ nodeId, message: t("warnings:createFailed", { message: getErrorMessage(err) }) });
        }
      })();
    },
    [tree, createNode, selectNode, setEditingNodeId, showToast, t],
  );

  const onInsertParent = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      // An Aspect is the top of the board: it has nothing above it but the root, and the backend
      // would refuse the move even if a parent were created for it.
      if (node.kind === "aspect") {
        showToast({ nodeId, message: t("warnings:insertParentAspectRefused") });
        return;
      }
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
          showToast({ nodeId, message: t("warnings:insertParentFailed", { message: getErrorMessage(err) }) });
        }
      })();
    },
    [tree, createChild, moveNode, selectNode, setEditingNodeId, showToast, t],
  );

  return {
    onStatusClick, onCommitEdit, onCreateChild, onCreateTypedChild, onCreateSibling,
    onInsertParent, onDelete, onPaste,
    occurrencePrompt, confirmOccurrence, cancelOccurrence,
  };
}
