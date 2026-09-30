import { useCallback, useEffect, useMemo, useState } from "react";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { listAllTaskDependencies } from "@/api/tasks";
import type { TaskDependencyEdge } from "@/api/tasks";
import type { TaskAgentic } from "@/api/tasks";
import { findNode, collectTasksAndGoals } from "@/utils/mindmap-tree";
import { storedSubtreeBase } from "@/utils/drawn-path";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { CommitmentListRow, ExpectationListRow, TaskListRow } from "@/utils/list-filter";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import { useExpectationActions } from "@/hooks/use-expectation-actions";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";
import { useStatusCycle } from "@/hooks/use-status-cycle";

interface ListData {
  tree: MindmapNode;
  /** Every Task row (stored, flow-materialized, and Habit occurrences), unfiltered. */
  rows: TaskListRow[];
  /** Every Commitment row, unfiltered — the section that sits above the task rows. */
  commitmentRows: CommitmentListRow[];
  /** Every Expectation row, unfiltered — stored waits and delegated Tasks' virtual ones. */
  expectationRows: ExpectationListRow[];
  /** The tree the rows are flattened from — the entered subtree, or the whole board. */
  listRoot: MindmapNode;
  /** Releases a wait, or takes a release back. */
  toggleRelease: (nodeId: string) => void;
  /** Every Task/Goal node, for the shared task/goal editor plumbing (dependency picker, etc.). */
  allTasksAndGoals: MindmapNode[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Cycles a row's status (todo → in_progress → done) — `useStatusCycle`'s gesture, so through
   * the occurrence completion guard and with the Backlog toast, exactly as on the Mindmap. */
  onCycleStatus: (nodeId: string) => void;
  /** `Alt+Enter`: sets a row's Task Started, or resumes a Started one to In Progress — through the
   * same guard and Backlog toast as `onCycleStatus`. */
  onToggleStarted: (nodeId: string) => void;
  /** The occurrence completion the backend is holding for confirmation, or `null`. */
  occurrencePrompt: OccurrencePrompt | null;
  /** Answers that prompt: marks the occurrence done and leaves its children in place. */
  confirmOccurrence: () => void;
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
  const { tree, isLoading, error, reload, renameNode, createNode, removeNode } = useMindmapData();
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const showToast = useMindmapStore((s) => s.showToast);
  const [taskDeps, setTaskDeps] = useState<TaskDependencyEdge[]>([]);

  useEffect(() => {
    void listAllTaskDependencies().then(setTaskDeps);
  }, [tree]);

  // Entering a subtree re-roots the List View exactly as it re-roots the Mindmap — same shared
  // `subtreeRootId`, so the two views are never in different places. Only the rows are scoped:
  // `tree` stays whole, because Ctrl+O searches the entire board from wherever you happen to be.
  const listRoot = useMemo(
    () => storedSubtreeBase(tree, subtreeRootId),
    [tree, subtreeRootId],
  );
  const rows = useMemo(() => flattenTaskRows(listRoot, taskDeps), [listRoot, taskDeps]);
  const commitmentRows = useMemo(() => flattenCommitmentRows(listRoot), [listRoot]);
  const expectationRows = useMemo(() => flattenExpectationRows(listRoot), [listRoot]);
  const { toggleRelease } = useExpectationActions({
    findNode: (id) => findNode(tree, id), reload, showToast,
  });
  // The Mindmap's and Steps View's own status gesture, so a row cycles exactly as its node does:
  // the same completion guard, the same Backlog toast, the same refusal out loud.
  const {
    cycleStatus: onCycleStatus, toggleStarted: onToggleStarted,
    occurrencePrompt, confirmOccurrence, cancelOccurrence,
  } = useStatusCycle({ findNode: (id) => findNode(tree, id), reload, showToast });
  const allTasksAndGoals = useMemo(() => {
    const acc: MindmapNode[] = [];
    collectTasksAndGoals(tree, acc);
    return acc;
  }, [tree]);

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
    tree, rows, commitmentRows, expectationRows, listRoot, toggleRelease,
    allTasksAndGoals, isLoading, error, reload, onCycleStatus, onToggleStarted,
    renameNode, createTask, deleteTask, removeNode,
    occurrencePrompt, confirmOccurrence, cancelOccurrence,
  };
}
