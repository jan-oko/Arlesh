import { useCallback, useEffect, useState } from "react";
import { isDerivedId, storedId } from "@/api/node-id";
import type { RowId } from "@/api/node-id";
import { dayStartInstant } from "@/utils/scope-calendar";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import { EXPECTATION_ARCHIVAL } from "@/api/expectation-status";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { InfoSaveData } from "@/components/InfoEditorModal/InfoEditorModal";
import { updateInfo } from "@/api/infos";
import type { FlowSaveData } from "@/components/FlowEditorModal/FlowEditorModal";
import { recurrenceRequest } from "@/components/FlowEditorModal/recurrence-ui";
import type { FlowItemSaveData } from "@/components/FlowItemEditorModal/FlowItemEditorModal";
import { flowOrigins } from "@/api/flows";
import type { FlowItemType, UpdateFlowItemRequest, UpdateFlowRequest } from "@/api/flows";
import { withAtomicGesture } from "@/api/gesture";
import { runGesture } from "@/api/multi-node-gestures";
import type { GestureStep, StepTarget } from "@/api/multi-node-gestures";
import type { Domain } from "@/api/domains";
import { listDomains, updateDomain } from "@/api/domains";
import { domainArchiveStatus, isArchivedByHand } from "@/utils/hand-archive";
import { scopeContainmentConflicts } from "@/api/tasks";
import type { UpdateTaskRequest, ViolatingDescendant } from "@/api/tasks";
import { TASK_ARCHIVAL } from "@/api/tasks";
import { COMMITMENT_ARCHIVAL } from "@/api/commitments";
import type { TimeScope } from "@/api/time-scope";
import { findNode } from "@/utils/mindmap-tree";
import { rowIdOf } from "@/utils/node-identity";
import { DOMAIN_SUBTYPE } from "@/api/domains";
import { isBegun, storedStatus } from "@/utils/status-mapping";
import { useAnswerQuestion } from "@/hooks/use-answer-question";
import { useScopeClampStore } from "@/stores/use-scope-clamp-store";

export interface EditorModalState {
  nodeId: string;
  node: MindmapNode;
  /** Opens a Task's editor at its Expectation section, Asynchronous switched on — `Shift+W`. */
  focus?: "asyncTemplate";
}

/** The writes that clamp every conflicting descendant's Time Scope to `window`, ahead of the
 * parent's own narrowing in the same Save. */
function clampSteps(conflicts: ViolatingDescendant[], window: TimeScope): GestureStep[] {
  return conflicts.map((conflict) => ({
    op: conflict.node_type === "goal" ? "update_goal" : "update_task",
    id: conflict.node_id,
    request: { time_scope: window },
  }));
}

/** The writes that put on the tags in `after` and take off those only in `before`. */
function tagSteps(kind: string, id: RowId, before: readonly number[], after: readonly number[]): GestureStep[] {
  return [
    ...after.filter((tag) => !before.includes(tag)).map((tag_id) => ({ op: "set_tag", kind, id, tag_id, present: true })),
    ...before.filter((tag) => !after.includes(tag)).map((tag_id) => ({ op: "set_tag", kind, id, tag_id, present: false })),
  ];
}

interface Options {
  tree: MindmapNode;
  allTasksAndGoals: MindmapNode[];
  reload: () => Promise<void>;
}

/**
 * Everything the editor plumbing hands back: the open modal, and the save path for every kind.
 *
 * Exported as a name of its own because `NodeEditorModals` takes the whole of it as one prop —
 * a component that renders the editor for *any* kind needs every handler in here, and spelling
 * them out one by one at the call site would put fifteen props between a view and its editor.
 */
export interface NodeEditorHandles {
  editorModal: EditorModalState | null;
  setEditorModal: (m: EditorModalState | null) => void;
  allTags: Domain[];
  domainNames: Map<number, string>;
  availableForDep: MindmapNode[];
  onDoubleClick: (nodeId: string) => void;
  onTaskSave: (data: TaskSaveData) => Promise<void>;
  /** Answers an agent's open question from the Task editor: stores the answer, releases the wait. */
  onAnswer: (question: MindmapNode, answer: string) => Promise<boolean>;
  onGoalSave: (data: GoalSaveData) => Promise<void>;
  onCommitmentSave: (data: CommitmentSaveData) => Promise<void>;
  onExpectationSave: (data: ExpectationSaveData) => Promise<void>;
  onSimpleSave: (title: string, isPrivate: boolean, archived: boolean | undefined) => Promise<void>;
  onProjectSave: (data: ProjectSaveData) => Promise<void>;
  onInfoSave: (data: InfoSaveData) => Promise<void>;
  onFlowSave: (data: FlowSaveData) => Promise<void>;
  onFlowItemSave: (data: FlowItemSaveData) => Promise<void>;
  /** Prompts to clamp orphaned descendants; resolves true to proceed, false to abort. */
  checkScopeClamp: (nodeType: "task" | "goal", dbId: number, timeScope: TimeScope) => Promise<boolean>;
  /** Opens the clamp prompt for an already-computed conflict set (e.g. from a drag reparent). The
   * prompt itself is `ScopeClampPrompt`, mounted at the root, so every view gets it. */
  confirmScopeClamp: (conflicts: ViolatingDescendant[]) => Promise<boolean>;
}

export function useNodeEditor({ tree, allTasksAndGoals, reload }: Options): NodeEditorHandles {
  const { t } = useTranslation("warnings");
  const { t: tUndo } = useTranslation("undo");
  const showToast = useMindmapStore((s) => s.showToast);
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);
  const [domainNames, setDomainNames] = useState<Map<number, string>>(new Map());
  const askScopeClamp = useScopeClampStore((s) => s.ask);

  // One load gives both the tags and the parent-domain titles used to section the tag picker.
  useEffect(() => {
    void listDomains().then((all) => {
      setAllTags(all.filter((d) => d.subtype === DOMAIN_SUBTYPE.TAG));
      setDomainNames(new Map(all.map((d) => [d.id, d.title])));
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
      return askScopeClamp(conflicts, flowOriginMap);
    },
    [askScopeClamp],
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
      // A derived row — a Habit occurrence, a wait's check task, a spawned or delegation wait —
      // opens the same editor as any row of its kind (ADR 0008); what it saves lands on that row
      // alone, in its overlay.
      if (node === undefined || node.kind === "aspect") return;
      setEditorModal({ nodeId: node.id, node });
    },
    [tree],
  );

  const onTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = rowIdOf(node);
      // The whole Save is one gesture operation: the clamps, the update and everything that hangs
      // on the Task, in one request — one transaction and one undo step, all or nothing.
      const steps: GestureStep[] = [];
      // An occurrence's window is its iteration's and does not change, so nothing is re-clamped.
      if (data.timeScope !== null && !isDerivedId(dbId)) {
        const conflicts = await scopeContainmentConflicts("task", dbId, data.timeScope);
        steps.push(...clampSteps(conflicts, data.timeScope));
      }
      // A task that consists of its sub-items and still does has no status to save: it is derived.
      const keepsDerived = node.compound === true && data.compound;
      const request: UpdateTaskRequest = {
        title: data.title,
        // Review is derived: the row holds On Agent, and that is what an unchanged save sends.
        ...(keepsDerived ? {} : { status: storedStatus(data.status) }),
        ...(data.compound !== (node.compound === true) ? { compound: data.compound } : {}),
        time_scope: data.timeScope,
        on_scope_exit: data.onScopeExit,
        plan: data.plan,
        ...(data.dueScope !== undefined ? { due_scope: data.dueScope } : {}),
        archival: data.archival,
        agentic: data.agentic,
        asynchronous: data.asynchronous,
        async_template: data.asyncTemplate,
        agentic_brief: data.agenticBrief,
        is_private: data.isPrivate,
        ...(data.delegate !== undefined ? { delegate_to: data.delegate } : {}),
      };
      // Tasks below a new Plan are settled in the same write, as the clamp prompt was answered.
      const settle = data.descendantPlans ?? null;
      steps.push({ op: "update_task", id: dbId, request, ...(settle === null ? {} : { descendant_plans: settle }) });
      // After the update, which is what makes a task newly marked Done Done at all.
      if (data.doneAt !== undefined) steps.push({ op: "set_task_done_at", id: dbId, at: data.doneAt });
      steps.push(
        { op: "set_block_reasons", owner_type: "task", id: dbId, reasons: data.blockReasons },
        ...tagSteps("task", dbId, node.tagIds, data.tagIds),
        ...data.addedDeps.map((dependency) => ({ op: "set_task_dependency", task_id: dbId, dependency, present: true })),
        ...data.removedDeps.map((dependency) => ({ op: "set_task_dependency", task_id: dbId, dependency, present: false })),
      );
      await runGesture("save-task", steps);
      // Scheduling a set-aside task puts it back in play, and so does starting one. The editor
      // already showed the switch go off, but the save is where it becomes true, so it is named
      // rather than left to be noticed.
      if (node.backlogged === true && data.archival === TASK_ARCHIVAL.LIVE) {
        if (data.plan !== null) showToast({ nodeId, message: t("backlogClearedByPlan") });
        else if (isBegun(data.status)) {
          // Wording only: the write itself cleared the flag, and the row it saved says so.
          const started = data.status.kind === "ordinary" && data.status.status === "started";
          showToast({ nodeId, message: t(started ? "backlogClearedByStarted" : "backlogClearedByStart") });
        }
      }
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload, showToast, t],
  );

  const answerQuestion = useAnswerQuestion({ reload, showToast });
  const onAnswer = useCallback(
    (question: MindmapNode, answer: string) => answerQuestion(question.id, rowIdOf(question), answer),
    [answerQuestion],
  );

  const onGoalSave = useCallback(
    async (data: GoalSaveData) => {
      if (editorModal === null) return;
      const { node } = editorModal;
      const dbId = rowIdOf(node);
      // One gesture operation: the clamps, the update, the block reasons and the tags.
      const steps: GestureStep[] = [];
      if (data.timeScope !== null && !isDerivedId(dbId)) {
        const conflicts = await scopeContainmentConflicts("goal", dbId, data.timeScope);
        steps.push(...clampSteps(conflicts, data.timeScope));
      }
      steps.push(
        {
          op: "update_goal", id: dbId,
          request: {
            title: data.title,
            status: data.status,
            time_scope: data.timeScope,
            on_scope_exit: data.onScopeExit,
            is_private: data.isPrivate,
          },
        },
        { op: "set_block_reasons", owner_type: "goal", id: dbId, reasons: data.blockReasons },
        ...tagSteps("goal", dbId, node.tagIds, data.tagIds),
      );
      await runGesture("save-goal", steps);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onExpectationSave = useCallback(
    async (data: ExpectationSaveData) => {
      if (editorModal === null) return;
      // A stored wait's id, or a derived one's UUID (a spawned or delegation wait): the backend
      // writes a derived wait's fields into its overlay and its tags as differences, that wait only.
      const dbId = rowIdOf(editorModal.node);
      // One gesture operation: the update and the tags.
      const request = {
        title: data.title,
        status: data.status,
        check_every: data.checkEvery,
        ...(data.checkStartingDate !== null ? { check_starting: dayStartInstant(data.checkStartingDate) } : {}),
        time_scope: data.timeScope,
        archival: data.archived ? EXPECTATION_ARCHIVAL.ARCHIVED : EXPECTATION_ARCHIVAL.LIVE,
        is_private: data.isPrivate,
        agentic: data.agentic,
        agentic_note: data.agenticNote,
        answer: data.agenticAnswer,
      };
      await runGesture("save-wait", [
        { op: "update_expectation", id: dbId, request },
        ...tagSteps("expectation", dbId, editorModal.node.tagIds, data.tagIds),
      ]);
      setEditorModal(null);
      await reload();
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
      const request = {
        title: data.title,
        verdict: data.verdict,
        time_scope: data.timeScope,
        verdict_window: data.verdictWindow,
        is_private: data.isPrivate,
        ...(data.archivedByHand !== undefined
          ? { archival: data.archivedByHand ? COMMITMENT_ARCHIVAL.ARCHIVED : COMMITMENT_ARCHIVAL.LIVE }
          : {}),
      };
      // One gesture operation: the update and the tags.
      await runGesture("save-commitment", [
        { op: "update_commitment", id: dbId, request },
        ...tagSteps("commitment", dbId, node.tagIds, data.tagIds),
      ]);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onFlowSave = useCallback(
    async (data: FlowSaveData) => {
      if (editorModal === null) return;
      const dbId = storedId(rowIdOf(editorModal.node));
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
        is_private: data.isPrivate,
        ...data.template,
      } satisfies UpdateFlowRequest;
      // The Recurrence for `target` is written after its flow row, so gap validation sees the new kind.
      const recurrenceSteps = (target: StepTarget): GestureStep[] => {
        if (data.recurrence === undefined) return [];
        if (data.recurrence === null) return [{ op: "delete_flow_recurrence", flow_id: target }];
        return [{ op: "set_flow_recurrence", flow_id: target, request: recurrenceRequest(data.recurrence, data.durationKind) }];
      };
      if (data.reconcile === "fork") {
        // Archive & new: the backend clones the template and archives the original (it stops
        // recurring, its history stays); the edit then lands on the clone. One gesture operation,
        // so all or nothing: a single Ctrl+Z takes the whole thing back, and a refusal part-way
        // leaves neither a stray clone nor an archived original behind.
        await withAtomicGesture(tUndo("gestures.archiveAndNew"), () => runGesture("save-flow", [
          { op: "fork_flow", flow_id: dbId },
          { op: "update_flow", id: { step: 0 }, request: flowFields },
          ...recurrenceSteps({ step: 0 }),
        ]));
      } else {
        await runGesture("save-flow", [
          ...(data.reconcile === "discard" ? [{ op: "clear_habit_modifications", flow_id: dbId }] : []),
          { op: "update_flow", id: dbId, request: flowFields },
          ...recurrenceSteps(dbId),
        ]);
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
      const dbId = storedId(rowIdOf(node));
      // One gesture for the whole save. The pairs go first: they are what may refuse — a change
      // that would orphan what occurrences recorded asks the Habit editor's question — and an
      // "Archive & new" answer moves the rest of the save onto the fork, whose item ids the
      // backend hands back.
      // One gesture operation. Each later write names its node through the first one, which
      // answers the Habit an *Archive & new* forked, if it forked one: its items' new ids.
      const onto = (type: FlowItemType, id: number): StepTarget => ({ step: 0, forked: type, id });
      const flowId: StepTarget = { step: 0, forked: "flow", id: flowItem.flowId };
      const itemId = onto(flowItem.itemType, dbId);
      const patch = {
        title: data.title, is_private: data.isPrivate, ...data.template, ...data.itemFields,
      } satisfies UpdateFlowItemRequest;
      const dependency = (dep: { type: FlowItemType; id: number }, present: boolean): GestureStep => ({
        op: "set_flow_dependency", flow_id: flowId, dependent_type: flowItem.itemType, dependent_id: itemId,
        depends_on_type: dep.type, depends_on_id: onto(dep.type, dep.id), present,
      });
      await withAtomicGesture(tUndo("gestures.editFlowItem"), () => runGesture("save-flow-item", [
        {
          op: "set_flow_item_cycles", flow_id: flowItem.flowId, item_type: flowItem.itemType, item_id: dbId,
          cycles: data.cycles.map((c) => ({
            scope_kind: c.scopeKind, scope_index: c.scopeIndex,
            plan_kind: c.planKind, plan_start: c.planStart, plan_end: c.planEnd,
          })),
          ...(data.reconcile === undefined ? {} : { reconcile: data.reconcile }),
        },
        { op: "update_flow_item", item_type: flowItem.itemType, id: itemId, request: patch },
        ...data.addedDeps.map((dep) => dependency(dep, true)),
        ...data.removedDeps.map((dep) => dependency(dep, false)),
      ]));
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload, tUndo],
  );

  const onSimpleSave = useCallback(
    async (title: string, isPrivate: boolean, archived: boolean | undefined) => {
      if (editorModal === null) return;
      const dbId = storedId(rowIdOf(editorModal.node));
      // Domain/tag editors: persist title, privacy and — a Domain's, when its switch moved — the
      // archive together, in one write, then refresh.
      const archiveChanged = archived !== undefined && archived !== isArchivedByHand(editorModal.node);
      await updateDomain(dbId, {
        title,
        is_private: isPrivate,
        ...(archiveChanged ? { status: domainArchiveStatus(archived) } : {}),
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onProjectSave = useCallback(
    async (data: ProjectSaveData) => {
      if (editorModal === null) return;
      const dbId = storedId(rowIdOf(editorModal.node));
      await runGesture("save-project", [{
        op: "update_domain", id: dbId,
        request: {
          title: data.title,
          is_private: data.isPrivate,
          ...(data.status !== "" ? { status: data.status } : {}),
          ...(data.knowledgeBaseDirectory !== "" ? { knowledge_base_directory: data.knowledgeBaseDirectory } : {}),
        },
      }]);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onInfoSave = useCallback(
    async (data: InfoSaveData) => {
      if (editorModal === null) return;
      const dbId = storedId(rowIdOf(editorModal.node));
      await updateInfo(dbId, { body: data.body, details: data.details, is_private: data.isPrivate });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  return {
    editorModal, setEditorModal, allTags, domainNames, availableForDep, onDoubleClick,
    onTaskSave, onAnswer, onGoalSave, onCommitmentSave, onExpectationSave, onSimpleSave, onProjectSave, onInfoSave,
    onFlowSave, onFlowItemSave,
    checkScopeClamp, confirmScopeClamp,
  };
}
