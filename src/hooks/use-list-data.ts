import { useCallback, useEffect, useMemo, useState } from "react";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { listAllTaskDependencies } from "@/api/tasks";
import type { TaskDependencyEdge } from "@/api/tasks";
import { updateTask } from "@/api/tasks";
import { setHabitItemStatus } from "@/api/flows";
import { TASK_STATUS } from "@/utils/status-mapping";
import { findNode, collectTasksAndGoals } from "@/utils/mindmap-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { TaskListRow } from "@/utils/list-filter";
import { flattenTaskRows } from "@/utils/list-data";

function nextTaskStatus(current: string): string {
  if (current === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.DONE;
  if (current === TASK_STATUS.DONE) return TASK_STATUS.TODO;
  return TASK_STATUS.IN_PROGRESS;
}

interface ListData {
  tree: MindmapNode;
  /** Every Task row (real, flow-materialized, and virtual Habit instances), unfiltered. */
  rows: TaskListRow[];
  /** Every Task/Goal node, for the shared task/goal editor plumbing (dependency picker, etc.). */
  allTasksAndGoals: MindmapNode[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Cycles a row's status (todo → in_progress → done), or advances a virtual Habit instance. */
  onCycleStatus: (nodeId: string) => void;
  /** Renames a task (inline rename, keyboard "R"). */
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
}

/** List View's data source: reuses the Mindmap's own tree (so the two views never drift out of
 * sync), plus the raw dependency edges the tree doesn't carry, flattened to one row per Task. */
export function useListData(): ListData {
  const { tree, isLoading, error, reload, renameNode } = useMindmapData();
  const [taskDeps, setTaskDeps] = useState<TaskDependencyEdge[]>([]);

  useEffect(() => {
    void listAllTaskDependencies().then(setTaskDeps);
  }, [tree]);

  const rows = useMemo(() => flattenTaskRows(tree, taskDeps), [tree, taskDeps]);
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
        const { flowId, itemType, itemId, scopeId } = node.habitItem;
        const cycled = nextTaskStatus(node.status ?? TASK_STATUS.TODO);
        const next = cycled === TASK_STATUS.TODO ? null : cycled;
        void setHabitItemStatus(flowId, itemType, itemId, scopeId, next, Date.now()).then(() => reload());
        return;
      }
      const dbId = parseInt(nodeId.split("-").pop() ?? "", 10);
      void updateTask(dbId, { status: nextTaskStatus(node.status ?? TASK_STATUS.TODO) }).then(() => reload());
    },
    [tree, reload],
  );

  return { tree, rows, allTasksAndGoals, isLoading, error, reload, onCycleStatus, renameNode };
}
