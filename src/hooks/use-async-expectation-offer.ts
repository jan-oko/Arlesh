import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { findParent } from "@/utils/mindmap-tree";
import { useDisplayStore } from "@/stores/use-display-store";
import { createExpectation, updateExpectation } from "@/api/expectations";
import { EXPECTATION_ARCHIVAL, EXPECTATION_STATUS } from "@/api/expectation-status";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import { addTaskDependency } from "@/api/tasks";
import { withAtomicGesture } from "@/api/gesture";
import { TASK_STATUS } from "@/utils/status-mapping";

/** Why the new-Expectation editor opened for a Task. */
export type AsyncOfferReason = "marked" | "done";

/** A Task the editor has been opened for, and where the new wait will hang. */
export interface AsyncExpectationOffer {
  reason: AsyncOfferReason;
  taskId: number;
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

/** The `parent_type` a sibling of a Task hanging under `parent` is written with. */
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
 * The two Asynchronous → Expectation behaviours, each behind its own setting:
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
      const marked = opensOnMark && now.asynchronous && !then.asynchronous;
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

  const save = useCallback(
    async (gestureName: string, data: ExpectationSaveData) => {
      if (offer === null) return;
      await withAtomicGesture(gestureName, async () => {
        const wait = await createExpectation({
          title: data.title,
          parent_type: offer.parentType,
          parent_id: offer.parentId,
          ...(data.checkBy !== null ? { check_by: data.checkBy } : {}),
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
        await addTaskDependency(offer.taskId, { type: "expectation", id: wait.id });
      });
      setOffer(null);
      await reload();
    },
    [offer, reload],
  );

  return { offer, dismiss, save };
}
