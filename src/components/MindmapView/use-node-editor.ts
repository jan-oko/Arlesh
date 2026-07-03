import { useCallback, useEffect, useState } from "react";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import type { FlowItemSaveData } from "@/components/FlowItemEditorModal/FlowItemEditorModal";
import {
  updateFlow, updateFlowGoal, updateFlowTask, setFlowItemCycles,
  addFlowDependency, removeFlowDependency, flowOrigins,
  setFlowRecurrence, deleteFlowRecurrence,
} from "@/api/flows";
import { getOrCreateScope } from "@/api/scopes";
import type { ScopeKind } from "@/api/scopes";
import type { Domain } from "@/api/domains";
import { listDomains, updateDomain } from "@/api/domains";
import {
  addTagToTask,
  removeTagFromTask,
  updateTask,
  addTaskDependency,
  removeTaskDependency,
  scopeContainmentConflicts,
} from "@/api/tasks";
import type { ViolatingDescendant } from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal, updateGoal } from "@/api/goals";
import type { TimeScope } from "@/api/time-scope";
import { findNode } from "@/utils/mindmap-tree";
import { DOMAIN_SUBTYPE } from "@/api/domains";

export interface EditorModalState {
  nodeId: string;
  node: MindmapNode;
}

/** A pending clamp-or-cancel prompt: the descendants a narrowed scope would orphan. */
export interface ScopeClampRequest {
  conflicts: ViolatingDescendant[];
  /** `"type-id"` → originating flow title, for descendants materialized from a flow. */
  flowOrigins: Record<string, string>;
  resolve: (proceed: boolean) => void;
}

/** Clamps every conflicting descendant's Time Scope to `window` before the parent narrows. */
async function clampDescendants(
  conflicts: ViolatingDescendant[],
  window: TimeScope,
): Promise<void> {
  for (const conflict of conflicts) {
    if (conflict.node_type === "goal") {
      await updateGoal(conflict.node_id, { time_scope: window });
    } else {
      await updateTask(conflict.node_id, { time_scope: window });
    }
  }
}

interface Options {
  tree: MindmapNode;
  allTasksAndGoals: MindmapNode[];
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  reload: () => Promise<void>;
}

interface Result {
  editorModal: EditorModalState | null;
  setEditorModal: (m: EditorModalState | null) => void;
  allTags: Domain[];
  availableForDep: MindmapNode[];
  onDoubleClick: (nodeId: string) => void;
  onTaskSave: (data: TaskSaveData) => Promise<void>;
  onGoalSave: (data: GoalSaveData) => Promise<void>;
  onSimpleSave: (title: string) => Promise<void>;
  onProjectSave: (data: ProjectSaveData) => Promise<void>;
  onFlowSave: (data: FlowSaveData) => Promise<void>;
  onFlowItemSave: (data: FlowItemSaveData) => Promise<void>;
  /** Prompts to clamp orphaned descendants; resolves true to proceed, false to abort. */
  checkScopeClamp: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  /** Opens the clamp prompt for an already-computed conflict set (e.g. from a drag reparent). */
  confirmScopeClamp: (conflicts: ViolatingDescendant[]) => Promise<boolean>;
  scopeClampRequest: ScopeClampRequest | null;
  resolveScopeClamp: (proceed: boolean) => void;
}

export function useNodeEditor({ tree, allTasksAndGoals, renameNode, reload }: Options): Result {
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);
  const [scopeClampRequest, setScopeClampRequest] = useState<ScopeClampRequest | null>(null);

  useEffect(() => { void listDomains(DOMAIN_SUBTYPE.TAG).then(setAllTags); }, []);

  const resolveScopeClamp = useCallback((proceed: boolean) => {
    setScopeClampRequest((request) => {
      request?.resolve(proceed);
      return null;
    });
  }, []);

  // Opens the clamp-or-cancel prompt for the given conflicts; resolves the user's choice. Annotates
  // any flow-originated descendants with their originating flow title (Phase 7.5).
  const confirmScopeClamp = useCallback(
    async (conflicts: ViolatingDescendant[]): Promise<boolean> => {
      const origins = await flowOrigins(
        conflicts.map((c) => ({ node_type: c.node_type, node_id: c.node_id })),
      );
      const flowOriginMap: Record<string, string> = {};
      for (const origin of origins) {
        flowOriginMap[`${origin.node_type}-${origin.node_id}`] = origin.flow_title;
      }
      return new Promise<boolean>((resolve) =>
        setScopeClampRequest({ conflicts, flowOrigins: flowOriginMap, resolve }),
      );
    },
    [],
  );

  // Returns true if the save may proceed: no orphaned descendants, or the user chose to clamp them.
  const checkScopeClamp = useCallback(
    async (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope): Promise<boolean> => {
      const conflicts = await scopeContainmentConflicts(nodeType, dbId, timeScope);
      if (conflicts.length === 0) return true;
      return confirmScopeClamp(conflicts);
    },
    [confirmScopeClamp],
  );

  const availableForDep =
    editorModal !== null ? allTasksAndGoals.filter((n) => n.id !== editorModal.nodeId) : [];

  const onDoubleClick = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      setEditorModal({ nodeId, node });
    },
    [tree],
  );

  const onTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      if (data.timeScope !== null) {
        const conflicts = await scopeContainmentConflicts("task", dbId, data.timeScope);
        await clampDescendants(conflicts, data.timeScope);
      }
      await updateTask(dbId, {
        title: data.title,
        status: data.status,
        blocked_reason: data.blockedReason,
        time_scope: data.timeScope,
        on_scope_exit: data.onScopeExit,
        plan: data.plan,
      });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToTask(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromTask(dbId, tagId);
      for (const dep of data.addedDeps) await addTaskDependency(dbId, dep);
      for (const dep of data.removedDeps) await removeTaskDependency(dbId, dep);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onGoalSave = useCallback(
    async (data: GoalSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      if (data.timeScope !== null) {
        const conflicts = await scopeContainmentConflicts("goal", dbId, data.timeScope);
        await clampDescendants(conflicts, data.timeScope);
      }
      await updateGoal(dbId, {
        title: data.title,
        status: data.status,
        blocked_reason: data.blockedReason,
        time_scope: data.timeScope,
        on_scope_exit: data.onScopeExit,
      });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToGoal(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromGoal(dbId, tagId);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onFlowSave = useCallback(
    async (data: FlowSaveData) => {
      if (editorModal === null) return;
      const { nodeId } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateFlow(dbId, {
        title: data.title,
        instance_type: data.instanceType,
        target_type: data.targetType,
        target_id: data.targetId,
        flow_duration_n: data.durationN,
        flow_duration_kind: data.durationKind,
        flow_window_part: data.windowPart,
        flow_window_time_start: data.windowTimeStart,
        flow_window_time_end: data.windowTimeEnd,
      });
      // Persist the Recurrence after the flow row, so gap validation sees the new scope kind.
      if (data.recurrence !== undefined) {
        if (data.recurrence === null) {
          await deleteFlowRecurrence(dbId);
        } else {
          const r = data.recurrence;
          // A sub-day (Phase) or unscoped kind pins its start on a Day scope.
          const startKind: ScopeKind =
            data.durationKind === "week" ? "week"
              : data.durationKind === "month" ? "month"
                : data.durationKind === "season" ? "season"
                  : "day";
          const startScope = await getOrCreateScope(startKind, r.startDate);
          const endScope = r.endDate !== null ? await getOrCreateScope(startKind, r.endDate) : null;
          await setFlowRecurrence(dbId, {
            start_scope_id: startScope.id,
            gap_n: r.gapN,
            gap_kind: r.gapKind,
            end_scope_id: endScope?.id ?? null,
            consumption_kind: r.consumptionKind,
            blocking_mode: r.blockingMode,
            catchup_policy: r.catchupPolicy,
          });
        }
      }
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onFlowItemSave = useCallback(
    async (data: FlowItemSaveData) => {
      if (editorModal === null) return;
      const { node } = editorModal;
      const flowItem = node.flowItem;
      if (flowItem === undefined) return;
      const dbId = parseInt(node.id.split("-").pop() ?? "0", 10);
      const patch = { title: data.title };
      if (flowItem.itemType === "flow_goal") {
        await updateFlowGoal(dbId, patch);
      } else {
        await updateFlowTask(dbId, patch);
      }
      await setFlowItemCycles(
        flowItem.flowId,
        flowItem.itemType,
        dbId,
        data.cycles.map((c) => ({
          scope_kind: c.scopeKind, scope_index: c.scopeIndex,
          plan_kind: c.planKind, plan_start: c.planStart, plan_end: c.planEnd,
        })),
      );
      for (const dep of data.addedDeps) {
        await addFlowDependency(flowItem.flowId, flowItem.itemType, dbId, dep.type, dep.id);
      }
      for (const dep of data.removedDeps) {
        await removeFlowDependency(flowItem.itemType, dbId, dep.type, dep.id);
      }
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onSimpleSave = useCallback(
    async (title: string) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      await renameNode(nodeId, node.kind, title);
      setEditorModal(null);
    },
    [editorModal, renameNode],
  );

  const onProjectSave = useCallback(
    async (data: ProjectSaveData) => {
      if (editorModal === null) return;
      const { nodeId } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateDomain(dbId, {
        title: data.title,
        ...(data.status !== "" ? { status: data.status } : {}),
        ...(data.knowledgeBaseDirectory !== "" ? { knowledge_base_directory: data.knowledgeBaseDirectory } : {}),
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  return {
    editorModal, setEditorModal, allTags, availableForDep, onDoubleClick,
    onTaskSave, onGoalSave, onSimpleSave, onProjectSave, onFlowSave, onFlowItemSave,
    checkScopeClamp, confirmScopeClamp, scopeClampRequest, resolveScopeClamp,
  };
}
