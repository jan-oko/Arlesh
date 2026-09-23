import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { listAllTaskDependencies } from "@/api/tasks";
import type { TaskDependencyEdge } from "@/api/tasks";
import { updateTask } from "@/api/tasks";
import type { TaskAgentic } from "@/api/tasks";
import { TASK_STATUS } from "@/utils/status-mapping";
import { cameOutOfBacklog, nextTaskStatus } from "@/utils/task-status-cycle";
import { findNode, collectTasksAndGoals } from "@/utils/mindmap-tree";
import { rowIdOf } from "@/utils/node-identity";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { CommitmentListRow, TaskListRow } from "@/utils/list-filter";
import { flattenCommitmentRows, flattenTaskRows } from "@/utils/list-data";
import { useOccurrenceCompletion } from "@/hooks/use-occurrence-completion";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";

interface ListData {
  tree: MindmapNode;
  /** Every Task row (real, flow-materialized, and virtual Habit instances), unfiltered. */
  rows: TaskListRow[];
  /** Every Commitment row, unfiltered — the section that sits above the task rows. */
  commitmentRows: CommitmentListRow[];
  /** Every Task/Goal node, for the shared task/goal editor plumbing (dependency picker, etc.). */
  allTasksAndGoals: MindmapNode[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Cycles a row's status (todo → in_progress → done), or advances a virtual Habit instance. */
  onCycleStatus: (nodeId: string) => void;
  /** The occurrence completion the backend is holding for confirmation, or `null`. */
  occurrencePrompt: OccurrencePrompt | null;
  /** Answers that prompt: marks the occurrence done and leaves its children in place. */
  confirmOccurrence: () => void;
  /** Writes one Habit occurrence's status through the completion guard — the context menu's way. */
  setOccurrenceStatus: (node: MindmapNode, status: string | null) => void;
  /** Declines it. Nothing was written, so nothing is undone. */
  cancelOccurrence: () => void;
  /** Renames a task (inline rename, keyboard "R"). */
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  /** Creates a blank To Do Task under a parent — List View's creation gestures make Tasks and
   * nothing else, so the child kind is fixed here rather than asked for. `agentic` seeds the new
   * Task's own flag; omitted, it starts in the Inherit every Task defaults to. */
  createTask: (parentId: string, parentKind: NodeKind, agentic?: TaskAgentic) => Promise<MindmapNode>;
  /** Deletes a Task by node id — how a create abandoned before it was named is taken back. */
  deleteTask: (id: string) => Promise<void>;
  /** The Mindmap's own delete writer, passed straight through so a row deleted from either view
   * takes the same path (and so one undo step covers both). */
  removeNode: (nodes: Array<{ id: string; kind: NodeKind }>) => Promise<void>;
}

/** List View's data source: reuses the Mindmap's own tree (so the two views never drift out of
 * sync), plus the raw dependency edges the tree doesn't carry, flattened to one row per Task. */
export function useListData(): ListData {
  const { t } = useTranslation(["warnings"]);
  const { tree, isLoading, error, reload, renameNode, createNode, removeNode } = useMindmapData();
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const showToast = useMindmapStore((s) => s.showToast);
  const { prompt: occurrencePrompt, setOccurrenceStatus, confirm: confirmOccurrence,
    cancel: cancelOccurrence } = useOccurrenceCompletion(reload);
  const [taskDeps, setTaskDeps] = useState<TaskDependencyEdge[]>([]);

  useEffect(() => {
    void listAllTaskDependencies().then(setTaskDeps);
  }, [tree]);

  // Entering a subtree re-roots the List View exactly as it re-roots the Mindmap — same shared
  // `subtreeRootId`, so the two views are never in different places. Only the rows are scoped:
  // `tree` stays whole, because Ctrl+O searches the entire board from wherever you happen to be.
  const listRoot = useMemo(
    () => (subtreeRootId !== null ? (findNode(tree, subtreeRootId) ?? tree) : tree),
    [tree, subtreeRootId],
  );
  const rows = useMemo(() => flattenTaskRows(listRoot, taskDeps), [listRoot, taskDeps]);
  const commitmentRows = useMemo(() => flattenCommitmentRows(listRoot), [listRoot]);
  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);

  const onCycleStatus = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind !== "task") return;
      if (node.habitItem !== undefined) {
        const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
        const next = cycled === TASK_STATUS.TODO ? null : cycled;
        // Through the completion guard, exactly as the Mindmap's status click is: the same
        // occurrence closed from either view asks the same question.
        setOccurrenceStatus(node, next);
        return;
      }
      void updateTask(rowIdOf(node), { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) }).then(async (updated) => {
        // Starting a set-aside task takes it out of the backlog, in the same write and so in the
        // same undo step. The row that comes back says whether it did; it is never assumed.
        if (cameOutOfBacklog(node, updated)) {
          showToast({ nodeId, message: t("warnings:backlogClearedByStart") });
        }
        await reload();
      });
    },
    [tree, reload, setOccurrenceStatus, showToast, t],
  );

  const createTask = useCallback(
    (parentId: string, parentKind: NodeKind, agentic?: TaskAgentic): Promise<MindmapNode> =>
      createNode(parentId, parentKind, "task", "", agentic),
    [createNode],
  );

  const deleteTask = useCallback(
    (id: string): Promise<void> => removeNode([{ id, kind: "task" }]),
    [removeNode],
  );

  return {
    tree, rows, commitmentRows, allTasksAndGoals, isLoading, error, reload, onCycleStatus,
    renameNode, createTask, deleteTask, removeNode,
    occurrencePrompt, confirmOccurrence, cancelOccurrence, setOccurrenceStatus,
  };
}
