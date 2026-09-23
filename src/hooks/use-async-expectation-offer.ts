import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode, findParent } from "@/utils/mindmap-tree";
import { expectationNodeId } from "@/utils/node-uuid";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { addTagToExpectation, createExpectation, updateExpectation } from "@/api/expectations";
import { EXPECTATION_ARCHIVAL, EXPECTATION_STATUS } from "@/api/expectation-status";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import { addTaskDependency, updateTask } from "@/api/tasks";
import { withAtomicGesture } from "@/api/gesture";
import { TASK_STATUS } from "@/utils/status-mapping";

/**
 * Why the new-Expectation editor opened.
 *
 * - `marked` — a Task was just marked Asynchronous (behind its setting);
 * - `done` — an Asynchronous Task was finished with nothing recorded as its wait (behind its setting);
 * - `bind` — `Shift+W` on a Task: it becomes Asynchronous **and** depends on the new wait;
 * - `create` — `Shift+E` in the List View: a wait under the selected row, bound to nothing.
 */
export type AsyncOfferReason = "marked" | "done" | "bind" | "create";

/** Where the new wait will hang, and the Task it is for, if any. */
export interface AsyncExpectationOffer {
  reason: AsyncOfferReason;
  /** The Task that will depend on the new wait; `null` for a plain create. */
  taskId: number | null;
  taskTitle: string;
  parentType: string;
  parentId: number;
}

/** What one Task looked like at the previous load — the three facts a transition is read from. */
interface TaskSnapshot {
  asynchronous: boolean;
  done: boolean;
  hasWait: boolean;
}

function snapshot(root: MindmapNode): Map<number, TaskSnapshot> {
  const tasks = new Map<number, TaskSnapshot>();
  function visit(node: MindmapNode): void {
    if (node.kind === "task" && node.rowId !== undefined && node.habitItem === undefined) {
      tasks.set(node.rowId, {
        asynchronous: node.asynchronous === true,
        done: node.status === TASK_STATUS.DONE,
        hasWait: (node.expectationDependencyIds?.length ?? 0) > 0,
      });
    }
    for (const child of node.children) visit(child);
  }
  visit(root);
  return tasks;
}

/** The `parent_type` a child of `parent` is written with — the spelling a Task's link takes. */
function parentTypeOf(parent: MindmapNode): string {
  if (parent.kind === "goal" || parent.kind === "task" || parent.kind === "commitment") return parent.kind;
  return "project";
}

function findTask(root: MindmapNode, taskId: number): MindmapNode | undefined {
  if (root.kind === "task" && root.rowId === taskId && root.habitItem === undefined) return root;
  for (const child of root.children) {
    const found = findTask(child, taskId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The new-Expectation editor for a Task's wait, and the two Asynchronous → Expectation behaviours
 * that open it, each behind its own setting:
 *
 * - **marking** a Task Asynchronous opens the new-Expectation editor for the wait it starts;
 * - **finishing** an Asynchronous Task that depends on no Expectation yet offers the same editor.
 *
 * Both are read off the tree as it reloads, rather than hooked into each of the gestures that can
 * cause them — the `W` key, the status control, `Enter`, the Task editor's switch and its status
 * pills. One observer cannot miss a route that a hook per gesture would have to remember.
 *
 * The new Expectation hangs beside the Task, and the Task depends on it: it is what the Task waits
 * to be released. Saving writes the wait and the edge as one Gesture, so one `Ctrl+Z` takes both.
 */
export function useAsyncExpectationOffer(tree: MindmapNode, reload: () => Promise<void>) {
  const { t } = useTranslation("expectation");
  const showToast = useMindmapStore((s) => s.showToast);
  const opensOnMark = useDisplayStore((s) => s.asynchronousOpensExpectation);
  const offersOnDone = useDisplayStore((s) => s.offerExpectationOnAsyncDone);
  const previous = useRef<Map<number, TaskSnapshot> | null>(null);
  const [offer, setOffer] = useState<AsyncExpectationOffer | null>(null);

  useEffect(() => {
    const current = snapshot(tree);
    const before = previous.current;
    previous.current = current;
    // The first tree a view sees is where it starts, not a change anyone made.
    if (before === null || before.size === 0) return;
    for (const [taskId, now] of current) {
      const then = before.get(taskId);
      if (then === undefined) continue;
      // Not when the Task already waits on something — `Shift+W`, for one, sets the flag and the
      // edge together, and asking again straight after would be asking twice.
      const marked = opensOnMark && now.asynchronous && !then.asynchronous && !now.hasWait;
      const done = offersOnDone && now.asynchronous && now.done && !then.done && !now.hasWait;
      if (!marked && !done) continue;
      const task = findTask(tree, taskId);
      const parent = task === undefined ? null : findParent(tree, task.id);
      // A Task hanging from something with no row — a Habit occurrence — has nowhere to put a
      // sibling, so nothing is offered rather than an editor whose save could only fail.
      if (task === undefined || parent === null || parent.rowId === undefined) continue;
      setOffer({
        reason: marked ? "marked" : "done",
        taskId,
        taskTitle: task.title,
        parentType: parentTypeOf(parent),
        parentId: parent.rowId,
      });
      return;
    }
  }, [tree, opensOnMark, offersOnDone]);

  const dismiss = useCallback(() => setOffer(null), []);

  /**
   * `Shift+W` on a Task: open the editor for the wait it starts. Saving marks the Task
   * Asynchronous and makes it depend on the new wait, in one Gesture. Refused out loud on anything
   * but a real Task, and on a Task that already waits on an Expectation — asking for a second one
   * would read as the first having been lost.
   */
  const bind = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined) return;
      if (node.kind !== "task" || node.rowId === undefined || node.habitItem !== undefined) {
        showToast({ nodeId, message: t("bindNotATask") });
        return;
      }
      const bound = node.expectationDependencyIds?.[0];
      if (bound !== undefined) {
        const wait = findNode(tree, expectationNodeId(bound));
        showToast({ nodeId, message: t("bindAlreadyWaits", { title: wait?.title ?? "" }) });
        return;
      }
      const parent = findParent(tree, nodeId);
      if (parent === null || parent.rowId === undefined) {
        showToast({ nodeId, message: t("bindNoPlace") });
        return;
      }
      setOffer({ reason: "bind", taskId: node.rowId, taskTitle: node.title, parentType: parentTypeOf(parent), parentId: parent.rowId });
    },
    [tree, showToast, t],
  );

  /** `Shift+E` in the List View: open the editor for a wait under `nodeId`. The caller has already
   * checked that the node can hold one. */
  const createUnder = useCallback(
    (nodeId: string) => {
      const parent = findNode(tree, nodeId);
      if (parent === undefined || parent.rowId === undefined) return;
      setOffer({ reason: "create", taskId: null, taskTitle: "", parentType: parentTypeOf(parent), parentId: parent.rowId });
    },
    [tree],
  );

  const save = useCallback(
    async (gestureName: string, data: ExpectationSaveData) => {
      if (offer === null) return;
      await withAtomicGesture(gestureName, async () => {
        const wait = await createExpectation({
          title: data.title,
          parent_type: offer.parentType,
          parent_id: offer.parentId,
          ...(data.checkBy !== null ? { check_by: data.checkBy } : {}),
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
        if (offer.taskId === null) return;
        if (offer.reason === "bind") await updateTask(offer.taskId, { asynchronous: true });
        await addTaskDependency(offer.taskId, { type: "expectation", id: wait.id });
      });
      setOffer(null);
      await reload();
    },
    [offer, reload],
  );

  return { offer, dismiss, save, bind, createUnder };
}
