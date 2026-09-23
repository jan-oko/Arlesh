import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { InfoSaveData } from "@/components/InfoEditorModal/InfoEditorModal";
import { updateInfo } from "@/api/infos";
import { clearBeadsId, type BeadsNodeType } from "@/api/beads";
import { setBlockReasons } from "@/api/block-reasons";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import { recurrenceStartKind } from "@/components/FlowEditorModal/recurrence-ui";
import type { FlowItemSaveData } from "@/components/FlowItemEditorModal/FlowItemEditorModal";
import {
  updateFlow, updateFlowGoal, updateFlowTask, setFlowItemCycles,
  addFlowDependency, removeFlowDependency, flowOrigins,
  setFlowRecurrence, deleteFlowRecurrence, forkFlow, clearHabitModifications,
} from "@/api/flows";
import { getOrCreateScope } from "@/api/scopes";
import type { FlowItemType, ForkedTemplate } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import { localNowIso } from "@/utils/local-now";
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
import { TASK_ARCHIVAL } from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal, updateGoal } from "@/api/goals";
import { addTagToCommitment, removeTagFromCommitment, updateCommitment } from "@/api/commitments";
import type { TimeScope } from "@/api/time-scope";
import { findNode } from "@/utils/mindmap-tree";
import { rowIdOf } from "@/utils/node-identity";
import { DOMAIN_SUBTYPE } from "@/api/domains";
import { TASK_STATUS } from "@/utils/status-mapping";
import { useOccurrenceEditor } from "@/hooks/use-occurrence-editor";
import type { OccurrenceEditorHandles } from "@/hooks/use-occurrence-editor";

/** A flow item's id on the fork an "Archive & new" save landed on — or its own, with no fork. */
function forkedItemId(forked: ForkedTemplate | null, type: FlowItemType, id: number): number {
  if (forked === null) return id;
  const pairs = type === "flow_goal" ? forked.goals : forked.tasks;
  return pairs.find(([old]) => old === id)?.[1] ?? id;
}

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
  reload: () => Promise<void>;
}

interface Result {
  editorModal: EditorModalState | null;
  setEditorModal: (m: EditorModalState | null) => void;
  allTags: Domain[];
  domainNames: Map<number, string>;
  availableForDep: MindmapNode[];
  onDoubleClick: (nodeId: string) => void;
  onTaskSave: (data: TaskSaveData) => Promise<void>;
  onGoalSave: (data: GoalSaveData) => Promise<void>;
  onCommitmentSave: (data: CommitmentSaveData) => Promise<void>;
  onSimpleSave: (title: string, isPrivate: boolean) => Promise<void>;
  onProjectSave: (data: ProjectSaveData) => Promise<void>;
  onInfoSave: (data: InfoSaveData) => Promise<void>;
  /** Drops the open node's `bd` issue link, from the editor's Save. `nodeType` is its own kind. */
  onClearBeadsId: (nodeType: BeadsNodeType) => Promise<void>;
  onFlowSave: (data: FlowSaveData) => Promise<void>;
  onFlowItemSave: (data: FlowItemSaveData) => Promise<void>;
  /** Prompts to clamp orphaned descendants; resolves true to proceed, false to abort. */
  checkScopeClamp: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  /** Opens the clamp prompt for an already-computed conflict set (e.g. from a drag reparent). */
  confirmScopeClamp: (conflicts: ViolatingDescendant[]) => Promise<boolean>;
  scopeClampRequest: ScopeClampRequest | null;
  resolveScopeClamp: (proceed: boolean) => void;
  /** The editor of one Habit item occurrence, which a double-click on one opens instead. */
  occurrenceEditor: OccurrenceEditorHandles;
}

export function useNodeEditor({ tree, allTasksAndGoals, reload }: Options): Result {
  const { t } = useTranslation("warnings");
  const { t: tUndo } = useTranslation("undo");
  const showToast = useMindmapStore((s) => s.showToast);
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);
  const [domainNames, setDomainNames] = useState<Map<number, string>>(new Map());
  const [scopeClampRequest, setScopeClampRequest] = useState<ScopeClampRequest | null>(null);
  const occurrenceEditor = useOccurrenceEditor(tree, reload);
  const openOccurrenceEditor = occurrenceEditor.open;

  // One load gives both the tags and the parent-domain titles used to section the tag picker.
  useEffect(() => {
    void listDomains().then((all) => {
      setAllTags(all.filter((d) => d.subtype === DOMAIN_SUBTYPE.TAG));
      setDomainNames(new Map(all.map((d) => [d.id, d.title])));
    });
  }, []);

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
      // A virtual Habit instance isn't backed by a real Task/Goal row — its Time Scope is derived
      // from the flow's Duration kind and the item's Cycle, not independently editable — and
      // it has no `rowId` for `onTaskSave`/`onGoalSave` to write to (`rowIdOf` would throw). An
      // item occurrence opens its own editor instead, which writes what it diverges by; the
      // iteration root stays read-only here.
      if (node === undefined || node.kind === "aspect") return;
      if (node.habitItem !== undefined) {
        openOccurrenceEditor(node);
        return;
      }
      setEditorModal({ nodeId, node });
    },
    [tree, openOccurrenceEditor],
  );

  const onTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = rowIdOf(node);
      if (data.timeScope !== null) {
        const conflicts = await scopeContainmentConflicts("task", dbId, data.timeScope);
        await clampDescendants(conflicts, data.timeScope);
      }
      await updateTask(dbId, {
        title: data.title,
        status: data.status,
        time_scope: data.timeScope,
        on_scope_exit: data.onScopeExit,
        plan: data.plan,
        archival: data.archival,
        agentic: data.agentic,
        asynchronous: data.asynchronous,
        is_private: data.isPrivate,
      });
      // Scheduling a set-aside task puts it back in play, and so does starting one. The editor
      // already showed the switch go off, but the save is where it becomes true, so it is named
      // rather than left to be noticed.
      if (node.backlogged === true && data.archival === TASK_ARCHIVAL.LIVE) {
        if (data.plan !== null) showToast({ nodeId, message: t("backlogClearedByPlan") });
        else if (data.status === TASK_STATUS.IN_PROGRESS) {
          showToast({ nodeId, message: t("backlogClearedByStart") });
        }
      }
      await setBlockReasons("task", dbId, data.blockReasons);
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToTask(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromTask(dbId, tagId);
      for (const dep of data.addedDeps) await addTaskDependency(dbId, dep);
      for (const dep of data.removedDeps) await removeTaskDependency(dbId, dep);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload, showToast, t],
  );

  const onGoalSave = useCallback(
    async (data: GoalSaveData) => {
      if (editorModal === null) return;
      const { node } = editorModal;
      const dbId = rowIdOf(node);
      if (data.timeScope !== null) {
        const conflicts = await scopeContainmentConflicts("goal", dbId, data.timeScope);
        await clampDescendants(conflicts, data.timeScope);
      }
      await updateGoal(dbId, {
        title: data.title,
        status: data.status,
        time_scope: data.timeScope,
        on_scope_exit: data.onScopeExit,
        is_private: data.isPrivate,
      });
      await setBlockReasons("goal", dbId, data.blockReasons);
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToGoal(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromGoal(dbId, tagId);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onCommitmentSave = useCallback(
    async (data: CommitmentSaveData) => {
      if (editorModal === null) return;
      const { node } = editorModal;
      const dbId = rowIdOf(node);
      // Any refusal — most likely clearing the last window above the commitment — propagates to
      // the modal, which shows it rather than closing on a save that did not happen.
      await updateCommitment(dbId, {
        title: data.title,
        verdict: data.verdict,
        time_scope: data.timeScope,
        verdict_window: data.verdictWindow,
        is_private: data.isPrivate,
      });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToCommitment(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromCommitment(dbId, tagId);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onFlowSave = useCallback(
    async (data: FlowSaveData) => {
      if (editorModal === null) return;
      const dbId = rowIdOf(editorModal.node);
      const flowFields = {
        title: data.title,
        instance_type: data.instanceType,
        target_type: data.targetType,
        target_id: data.targetId,
        flow_duration_n: data.durationN,
        flow_duration_kind: data.durationKind,
        flow_window_part: data.windowPart,
        flow_window_time_start: data.windowTimeStart,
        flow_window_time_end: data.windowTimeEnd,
        root_plan_kind: data.rootPlanKind,
        root_plan_start: data.rootPlanStart,
        root_plan_end: data.rootPlanEnd,
        verdict_window_n: data.verdictWindowN,
        verdict_window_kind: data.verdictWindowKind,
        isPrivate: data.isPrivate,
      };
      // Persist the Recurrence for `targetId` after its flow row, so gap validation sees the new kind.
      const persistRecurrence = async (targetId: number) => {
        if (data.recurrence === undefined) return;
        if (data.recurrence === null) {
          await deleteFlowRecurrence(targetId);
          return;
        }
        const r = data.recurrence;
        const startKind = recurrenceStartKind(data.durationKind);
        const startScope = await getOrCreateScope(startKind, r.startDate);
        const endScope = r.endDate !== null ? await getOrCreateScope(startKind, r.endDate) : null;
        await setFlowRecurrence(targetId, {
          start_scope_id: startScope.id,
          gap_n: r.gapN,
          gap_kind: r.gapKind,
          end_scope_id: endScope?.id ?? null,
          consumption_kind: r.consumptionKind,
          blocking_mode: r.blockingMode,
          catchup_policy: r.catchupPolicy,
        });
      };
      if (data.reconcile === "fork") {
        // Archive & new: the backend clones the template and archives the original (it stops
        // recurring, its history stays); the edit then lands on the clone. One Gesture, and an
        // atomic one: a single Ctrl+Z takes the whole thing back, and a refusal part-way leaves
        // neither a stray clone nor an archived original behind.
        await withAtomicGesture(tUndo("gestures.archiveAndNew"), async () => {
          const clone = await forkFlow(dbId, localNowIso());
          await updateFlow(clone.id, flowFields);
          await persistRecurrence(clone.id);
        });
      } else {
        if (data.reconcile === "discard") await clearHabitModifications(dbId);
        await updateFlow(dbId, flowFields);
        await persistRecurrence(dbId);
      }
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload, tUndo],
  );

  const onFlowItemSave = useCallback(
    async (data: FlowItemSaveData) => {
      if (editorModal === null) return;
      const { node } = editorModal;
      const flowItem = node.flowItem;
      if (flowItem === undefined) return;
      const dbId = rowIdOf(node);
      // One gesture for the whole save. The pairs go first: they are what may refuse — a change
      // that would orphan recorded edits asks the Habit editor's question — and an "Archive & new"
      // answer moves the rest of the save onto the fork, whose item ids the backend hands back.
      await withAtomicGesture(tUndo("gestures.editFlowItem"), async () => {
        const forked = await setFlowItemCycles(
          flowItem.flowId,
          flowItem.itemType,
          dbId,
          data.cycles.map((c) => ({
            scope_kind: c.scopeKind, scope_index: c.scopeIndex,
            plan_kind: c.planKind, plan_start: c.planStart, plan_end: c.planEnd,
          })),
          data.reconcile,
          localNowIso(),
        );
        const onto = (type: FlowItemType, id: number): number => forkedItemId(forked, type, id);
        const flowId = forked?.flow_id ?? flowItem.flowId;
        const itemId = onto(flowItem.itemType, dbId);
        const patch = { title: data.title, isPrivate: data.isPrivate };
        if (flowItem.itemType === "flow_goal") {
          await updateFlowGoal(itemId, patch);
        } else {
          await updateFlowTask(itemId, patch);
        }
        for (const dep of data.addedDeps) {
          await addFlowDependency(flowId, flowItem.itemType, itemId, dep.type, onto(dep.type, dep.id));
        }
        for (const dep of data.removedDeps) {
          await removeFlowDependency(flowItem.itemType, itemId, dep.type, onto(dep.type, dep.id));
        }
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload, tUndo],
  );

  const onSimpleSave = useCallback(
    async (title: string, isPrivate: boolean) => {
      if (editorModal === null) return;
      const dbId = rowIdOf(editorModal.node);
      // Domain/tag editors: persist title and privacy together, then refresh.
      await updateDomain(dbId, { title, is_private: isPrivate });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onProjectSave = useCallback(
    async (data: ProjectSaveData) => {
      if (editorModal === null) return;
      const dbId = rowIdOf(editorModal.node);
      await updateDomain(dbId, {
        title: data.title,
        is_private: data.isPrivate,
        ...(data.status !== "" ? { status: data.status } : {}),
        ...(data.knowledgeBaseDirectory !== "" ? { knowledge_base_directory: data.knowledgeBaseDirectory } : {}),
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onInfoSave = useCallback(
    async (data: InfoSaveData) => {
      if (editorModal === null) return;
      const dbId = rowIdOf(editorModal.node);
      await updateInfo(dbId, { body: data.body, details: data.details, is_private: data.isPrivate });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  // Unlinks the open node from its `bd` issue. Its own call rather than a field on the update
  // request — no update request carries a beads field — but the editor's *Save* is what calls it,
  // not the ×: the × only stages the drop, so Cancel discards it like any other unsaved field.
  // The reload stands on its own rather than leaning on the save's, because the save can still be
  // refused after the clear has landed, and the board would then keep showing a link that is gone.
  const onClearBeadsId = useCallback(
    async (nodeType: BeadsNodeType) => {
      if (editorModal === null) return;
      const dbId = rowIdOf(editorModal.node);
      await clearBeadsId(nodeType, dbId);
      await reload();
    },
    [editorModal, reload],
  );

  return {
    occurrenceEditor,
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onGoalSave, onCommitmentSave, onSimpleSave, onProjectSave, onInfoSave,
    onClearBeadsId,
    onFlowSave, onFlowItemSave,
    checkScopeClamp, confirmScopeClamp, scopeClampRequest, resolveScopeClamp,
  };
}
