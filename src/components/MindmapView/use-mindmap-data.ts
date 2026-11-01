import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useDisplayStore } from "@/stores/use-display-store";
import { useTranslation } from "react-i18next";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { agentActivityFrom } from "@/utils/agent-activity";
import { createDomain, updateDomain, duplicateDomain } from "@/api/domains";
import { createTask, updateTask, duplicateTask, TASK_ARCHIVAL } from "@/api/tasks";
import { createCommitment, updateCommitment, addTagToCommitment, COMMITMENT_ARCHIVAL } from "@/api/commitments";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { Commitment } from "@/api/commitments";
import { createExpectation, updateExpectation } from "@/api/expectations";
import { EXPECTATION_ARCHIVAL } from "@/api/expectation-status";
import type { Expectation } from "@/api/expectations";
import { expectationNodeId } from "@/utils/node-uuid";
import { VERDICT } from "@/api/verdict";
import type { Delegate, TaskAgentic, TaskDependencyEdge } from "@/api/tasks";
import type { BlockReason } from "@/api/block-reasons";
import { createGoal, updateGoal, duplicateGoal } from "@/api/goals";
import { createInfo, updateInfo, duplicateInfo } from "@/api/infos";
import { leftBehindOf } from "@/api/duplicate";
import type { LeftBehindChild } from "@/api/duplicate";
import { getErrorMessage } from "@/api/errors";
import { loadMindmap } from "@/api/mindmap";
import { withGesture } from "@/api/gesture";
import { useBoardChanged } from "@/hooks/use-board-changed";
import { awaitLane, usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { usePendingWrite } from "@/hooks/use-pending-write";
import { useTemporaryIds } from "@/hooks/use-temporary-ids";
import { useReadOnlyNotice } from "@/hooks/use-read-only-notice";
import { createdWrite, writtenWith } from "@/utils/answer-fields";
import { shownTitle } from "@/utils/editor-save-fields";
import { applyPendingWrites } from "@/utils/apply-pending-writes";
import { isReflected } from "@/utils/pending-writes";
import type { BoardStamp } from "@/utils/pending-writes";
import { useBoardRevisionStore } from "@/stores/board-revision-store";
import type { MindmapLoad } from "@/api/mindmap";
import {
  createFlow, updateFlow,
  createFlowItem, updateFlowItem, isFlowItemType, flowItemNodeId,
  duplicateFlow, duplicateFlowItem,
} from "@/api/flows";
import { rowIdOf, rowIdOfNodeId } from "@/utils/node-identity";
import { canParentNewChild, validParentKinds } from "@/utils/node-meta";
import { TASK_STATUS, GOAL_STATUS } from "@/utils/status-mapping";
import { listPeople } from "@/api/people";
import { isClientMode, useClientModeStore } from "@/stores/use-client-mode-store";
import { deleteNodes, runGesture } from "@/api/multi-node-gestures";
import type { GestureStep } from "@/api/multi-node-gestures";
import { useMcpAccessStore } from "@/stores/use-mcp-access-store";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import { formatCooldownUntil } from "@/utils/cooldown-until";
import { blockedByText } from "@/utils/blocked-by";
import type { Goal } from "@/api/goals";
import type { Info } from "@/api/infos";
import type {
  Flow, CreateFlowRequest, UpdateFlowRequest,
  FlowGoal, FlowTask, FlowCommitment, FlowExpectation, FlowItemCycle, FlowDependency, FlowItemType,
  TargetRef, TemplateFields,
} from "@/api/flows";
import type { ItemLifecycle } from "@/api/scope-lifecycle";
import type { DependencyBlock, NodeFacts } from "@/api/mindmap";
import type { MindmapNode, NodeKind, FlowCyclePair, FlowItemDep } from "@/utils/tree-layout";
import { formatScopeCore } from "@/utils/scope-format";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import type { CanonicalKind } from "@/utils/scope-ref";
import type { DurationSpec, TimeScope } from "@/api/time-scope";
import { localNowIso } from "@/utils/local-now";
import { checkOrigin, habitOrigin, storedId } from "@/api/node-id";
import type { RowId } from "@/api/node-id";


/** Stamps each Task/Goal/Commitment node with its derived lifecycle (Timing, then Resolution or
 * Verdict, then effective Archival). */
export function applyLifecycles(node: MindmapNode, byId: Map<string, ItemLifecycle>): void {
  const entry = byId.get(node.id);
  if (entry !== undefined) {
    node.timing = entry.timing;
    if (entry.plan_timing !== undefined) node.planTiming = entry.plan_timing;
    if (entry.resolution !== undefined) node.resolution = entry.resolution;
    if (entry.overdue === true) node.overdue = true;
    // A Commitment's verdict comes back on the same envelope, in place of a Resolution. It is
    // already on the node from its own row; re-stamping it keeps the two from disagreeing when
    // a derivation and a row read land out of order.
    if (entry.verdict !== undefined) node.verdict = entry.verdict;
    node.archived = entry.archival === "archived";
    node.archivalConflict = entry.archival_conflict;
  }
  for (const child of node.children) applyLifecycles(child, byId);
}

/**
 * Each lifecycle keyed by the node id it stamps: an Expectation's by its minted id, every other row
 * — a wait's check task and a Habit occurrence included — by `kind-<row id>`.
 */
export function lifecycleMap(lifecycles: ItemLifecycle[]): Map<string, ItemLifecycle> {
  return new Map(lifecycles.map((l): [string, ItemLifecycle] => {
    if (l.node_type === "expectation") return [expectationNodeId(l.node_id), l];
    return [`${l.node_type}-${l.node_id}`, l];
  }));
}

function toCanonicalKind(kind: string | null): CanonicalKind | null {
  return kind === "day" || kind === "week" || kind === "month" || kind === "season" ? kind : null;
}

/**
 * A habit iteration's anchor, formatted as a scope of the flow's Duration kind (e.g. "W28", per
 * SPEC's `{flow title} {start scope}`) rather than the raw ISO date — falls back to the raw date
 * for a sub-day (Phase) window, which has no canonical scope label.
 */
function iterationAnchorLabel(flow: Flow, anchorDate: string, labels: ScopeLabelFns): string {
  const kind = toCanonicalKind(flow.flow_duration_kind);
  return kind === null ? anchorDate : formatScopeCore(kind, anchorDate, labels);
}

/**
 * Whether a flow's template holds items its own Instance Type cannot parent: goal items under a
 * flow that materializes a Commitment, which holds Tasks and other Commitments but no Goals.
 *
 * The backend derives no occurrences for such a flow, since `start` would refuse it outright; the
 * condition is reported to the user by {@link collectLoadConditions}, never left a quiet omission.
 */
export function holdsUnrenderableGoalItems(flow: Flow, flowGoals: readonly FlowGoal[]): boolean {
  return flow.instance_type === "commitment" && flowGoals.some((goal) => goal.flow_id === flow.id);
}

/** Draws an iteration root that carries missed windows: `{title} {scope} from {first}`. */
export type CarriesMissedTitle = (parts: { title: string; scope: string; first: string }) => string;

/**
 * What the board draws on a Habit's **iteration roots**, beyond the rows themselves.
 *
 * A Habit's occurrences arrive as ordinary Task, Goal and Commitment rows (ADR 0008) and are
 * built into the tree like any other; only an iteration root is drawn differently, and only here:
 *
 *  - its title reads `{title} {start scope}` ("Exercise W22"), and — under Window + Overdue, for
 *    the iteration carrying a run of missed ones — `{title} {start scope} from {first missed}`
 *    ("Water the plants W3 from W1"), through `carriesMissed`, which localises it. The row's own
 *    title is kept as `rowTitle`, which is what an editor edits — the label is how it is drawn,
 *    not what it is;
 *  - it carries the `habitIteration` the collapse of passed iterations folds by, read off its
 *    `origin`: where its window sits, whether that window has passed at `now`, and how it ended.
 */
export function decorateIterationRoots(
  node: MindmapNode,
  flows: readonly Flow[],
  labels: ScopeLabelFns,
  now: string,
  carriesMissed: CarriesMissedTitle,
): void {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  const visit = (current: MindmapNode): void => {
    const habit = habitOrigin(current.origin);
    const flow = habit === undefined ? undefined : byId.get(habit.habit_id);
    if (habit !== undefined && habit.item_type === "flow_root" && flow !== undefined) {
      const iteration = habit.iteration_scope;
      current.rowTitle = current.title;
      const scope = iterationAnchorLabel(flow, iteration.start_date, labels);
      current.title = iteration.missed_from === undefined
        ? `${current.title} ${scope}`
        : carriesMissed({
            title: current.title,
            scope,
            first: iterationAnchorLabel(flow, iteration.missed_from, labels),
          });
      current.habitIteration = {
        flowId: flow.id,
        flowTitle: flow.title,
        index: iteration.index,
        scopeKind: toCanonicalKind(flow.flow_duration_kind),
        anchorDate: iteration.start_date,
        windowEnd: iteration.window_end,
        // Under Overlapping nothing lapses, so a long-closed window can still be `active`:
        // whether it has passed is read off its end, not its state.
        passed: iteration.window_end <= now,
        // Finishing as intended: completed for a work Habit, Kept for a commitment one.
        done: current.kind === "commitment"
          ? current.verdict === VERDICT.KEPT
          : current.status === TASK_STATUS.DONE || current.status === GOAL_STATUS.ACHIEVED,
        // Owed work stays in view rather than folding into the Habit's history.
        ...(iteration.owed === true ? { owed: true } : {}),
      };
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
}

interface MindmapData {
  tree: MindmapNode;
  isLoading: boolean;
  error: string | null;
  /** Background load conditions from the most recent load — currently, Habit derivation failures. */
  loadCondition: LoadCondition;
  /**
   * `agentic` is the Agentic state a new **Task** is created carrying; omitted, it starts in the
   * Inherit every Task defaults to. Ignored by every other kind, since only a Task has the flag.
   */
  createNode: (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string, agentic?: TaskAgentic) => Promise<MindmapNode>;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  /** Waits for a created node's real row to be on the board; `undefined` when its create was refused. */
  settleCreated: (placeholder: MindmapNode) => Promise<MindmapNode | undefined>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  reorderNode: (id: string, direction: 1 | -1) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number) => Promise<void>;
  /** Resolves with the rows hung on Habit occurrences that the copy could not carry. */
  duplicateNode: (id: string, kind: NodeKind, targetId: string, targetKind: NodeKind, position: number) => Promise<readonly LeftBehindChild[]>;
  /** *Insert parent* as one gesture operation; resolves with the new parent's node id. */
  insertParent: (nodeId: string, kind: NodeKind, parentId: string, parentKind: NodeKind) => Promise<string>;
  /** Copies or moves several nodes as one gesture operation; see `useNodeActions`'s `pasteNodes`. */
  pasteNodes: (items: ReadonlyArray<{ id: string; kind: NodeKind }>, targetId: string, targetKind: NodeKind, position: number, copy: boolean) => Promise<readonly LeftBehindChild[]>;
  removeNode: (nodesToDelete: Array<{ id: string; kind: NodeKind }>) => Promise<void>;
  /** Writes a commitment configured in the new-commitment editor, window and all, under a parent. */
  createCommitment: (parentId: string, parentKind: NodeKind, data: CommitmentSaveData) => Promise<void>;
  createFlow: (request: CreateFlowRequest) => Promise<Flow>;
  updateFlow: (id: number, request: UpdateFlowRequest) => Promise<void>;
  reload: () => Promise<void>;
}

const VIRTUAL_ROOT: MindmapNode = {
  id: "root",
  kind: "domain",
  title: "Arlesh",
  position: 0,
  tagIds: [],
  children: [],
};

function kindToParentType(kind: NodeKind): string {
  if (kind === "goal") return "goal";
  if (kind === "task") return "task";
  if (kind === "commitment") return "commitment";
  return "project";
}

function kindToInfoParentType(kind: NodeKind): string {
  switch (kind) {
    case "goal": return "goal";
    case "task": return "task";
    case "info": return "info";
    case "aspect": return "aspect";
    case "project": return "project";
    case "domain": return "domain";
    case "tag": return "tag";
    case "commitment": return "commitment";
    case "expectation": return "expectation";
    case "flow": throw new Error("Flow nodes cannot parent info nodes");
    case "flow_goal": case "flow_task": case "flow_commitment": case "flow_expectation":
      throw new Error("Flow items cannot parent info nodes");
    case "habit_group": throw new Error("A folded Habit history cannot parent info nodes");
  }
}

/**
 * Maps a parent node kind to the `parent_type` a flow stores. A flow hangs from an Aspect,
 * Domain, Project or Goal and from nothing else, so every other kind throws rather than
 * writing a parent link the flows table would reject.
 */
function kindToFlowParentType(kind: NodeKind): string {
  switch (kind) {
    case "aspect": case "domain": case "project": case "goal": return kind;
    case "task": case "commitment": case "expectation": case "tag": case "info":
    case "flow": case "flow_goal": case "flow_task": case "flow_commitment": case "flow_expectation":
    case "habit_group":
      throw new Error(`Flows cannot hang from a node of kind "${kind}"`);
  }
}

/**
 * The `parent_type` a flow item records for an in-flow parent. The three flow kinds spell it
 * exactly as they are named; every real kind is refused, because a flow item lives nowhere but
 * inside its flow.
 */
function kindToFlowItemParentType(kind: NodeKind): string {
  switch (kind) {
    case "flow": case "flow_goal": case "flow_task": case "flow_commitment": return kind;
    // `habit_group` is among them because a folded run of passed iterations is drawn, not stored
    // — it is nobody's parent.
    case "aspect": case "domain": case "project": case "goal":
    case "task": case "commitment": case "expectation": case "tag": case "info": case "habit_group":
    case "flow_expectation":
      throw new Error(`Flow items cannot hang from a node of kind "${kind}"`);
  }
}

function findNodeInTree(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeInTree(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParentInTree(root: MindmapNode, id: string): MindmapNode | undefined {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParentInTree(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function subtypeToKind(subtype: string): NodeKind {
  switch (subtype) {
    case "aspect": return "aspect";
    case "project": return "project";
    case "tag": return "tag";
    default: return "domain";
  }
}

function propagateAspectColor(node: MindmapNode, inheritedColor: string | undefined): void {
  const colorToPropagate = node.kind === "aspect" ? node.color : inheritedColor;
  if (node.kind !== "aspect" && colorToPropagate !== undefined && node.color === undefined) {
    node.color = colorToPropagate;
  }
  for (const child of node.children) {
    propagateAspectColor(child, colorToPropagate);
  }
}

function infoParentKey(info: Info): string {
  if (info.parent_type === "goal") return `goal-${info.parent_id}`;
  if (info.parent_type === "task") return `task-${info.parent_id}`;
  if (info.parent_type === "commitment") return `commitment-${info.parent_id}`;
  if (info.parent_type === "expectation") return expectationNodeId(info.parent_id);
  if (info.parent_type === "info") return `info-${info.parent_id}`;
  return `domain-${info.parent_id}`;
}

/** The tree node id a content node's `(parent_type, parent_id)` pair names. The three content
 * tables spell their parents `goal`, `task`, `commitment` or a domains-table kind, which the tree
 * keys under the single `domain-` namespace. */
function contentParentKey(parentType: string, parentId: RowId): string {
  if (parentType === "expectation") return expectationNodeId(parentId);
  if (parentType === "goal") return `goal-${parentId}`;
  if (parentType === "task") return `task-${parentId}`;
  if (parentType === "commitment") return `commitment-${parentId}`;
  return `domain-${parentId}`;
}

/** A template item's own fields, as the item editor edits them. */
function templateFieldsOf(item: TemplateFields): TemplateFields {
  return {
    ...(item.delegate_to !== undefined ? { delegate_to: item.delegate_to } : {}),
    ...(item.agentic !== undefined ? { agentic: item.agentic } : {}),
    ...(item.asynchronous !== undefined ? { asynchronous: item.asynchronous } : {}),
    ...(item.archival !== undefined ? { archival: item.archival } : {}),
    ...(item.agentic_brief !== undefined ? { agentic_brief: item.agentic_brief } : {}),
    ...(item.compound !== undefined ? { compound: item.compound } : {}),
    ...(item.async_template !== undefined ? { async_template: item.async_template } : {}),
    tag_ids: item.tag_ids ?? [],
    block_reasons: item.block_reasons ?? [],
  };
}

/** Node id of a flow item's in-flow parent (the flow itself, or another item). */
function flowItemParentKey(flowId: number, parentType: string, parentId: number): string {
  return isFlowItemType(parentType) ? flowItemNodeId(parentType, parentId) : `flow-${flowId}`;
}

function toCyclePair(cycle: FlowItemCycle): FlowCyclePair {
  return {
    scopeKind: cycle.scope_kind, scopeIndex: cycle.scope_index,
    planKind: cycle.plan_kind, planStart: cycle.plan_start, planEnd: cycle.plan_end,
  };
}


/** A Task's `delegateName` field: its Person delegate's name, when it has one that is known. */
function personNameOf(
  delegate: Delegate | null | undefined, personNames: ReadonlyMap<number, string>,
): { delegateName?: string } {
  const name = delegate?.kind === "person" ? personNames.get(delegate.id) : undefined;
  return name === undefined ? {} : { delegateName: name };
}

/**
 * What a Habit cooldown's derived block puts on a node: its reason among the virtual blockers,
 * which is what makes the node read as blocked, and the instant it lifts. Nothing when the node
 * is not cooling down.
 */
function cooldownFields(
  until: string | undefined,
  reason: (until: string) => string,
): Pick<MindmapNode, "virtualBlockers" | "coolingUntil"> {
  if (until === undefined) return {};
  return { virtualBlockers: [reason(until)], coolingUntil: until };
}

/** The tree node a fact's key names: a wait's is its minted id, every other node's is the key. */
function factNodeKey(key: string): string {
  const wait = /^expectation-(.+)$/.exec(key);
  if (wait?.[1] === undefined) return key;
  const id = Number(wait[1]);
  return expectationNodeId(Number.isNaN(id) ? wait[1] : id);
}

/** The node id a dependency's target is drawn under. */
function dependencyNodeId(block: DependencyBlock): string {
  if (block.kind === "expectation") return expectationNodeId(block.id);
  return `${block.kind}-${block.id}`;
}

/** Stamps what the board's rules say about `node` onto it. */
function applyFacts(node: MindmapNode, fact: NodeFacts): void {
  if (fact.inherited_agentic === true) node.inheritedAgentic = true;
  if (fact.inherited_time_scope !== undefined) node.inheritedTimeScope = fact.inherited_time_scope;
  if (fact.inherited_plan !== undefined) node.inheritedPlan = fact.inherited_plan;
  if (fact.plan_source !== undefined) {
    node.planSource = { nodeId: fact.plan_source, shortId: fact.plan_source_short_id ?? null };
  }
  if (fact.plan_conflict !== undefined) node.planConflict = fact.plan_conflict;
  if (fact.open_question !== undefined) node.openQuestionId = fact.open_question;
  if (fact.expired === true) node.expired = true;
  if (fact.met === true) node.met = true;
  if (fact.mcp_visible_via !== undefined) node.mcpVisibleVia = fact.mcp_visible_via;
  if (fact.capabilities !== undefined) node.capabilities = fact.capabilities;
  for (const block of fact.dependency_blocks ?? []) {
    node.virtualBlockers = [...(node.virtualBlockers ?? []), blockedByText(block.kind, block.short_id, block.id, block.title)];
    node.blockingDependencyIds = [...(node.blockingDependencyIds ?? []), dependencyNodeId(block)];
  }
}

export function buildTree(
  domains: Domain[],
  goals: Goal[],
  tasks: Task[],
  infos: Info[],
  commitments: Commitment[] = [],
  flows: Flow[] = [],
  flowGoals: FlowGoal[] = [],
  flowTasks: FlowTask[] = [],
  flowCycles: FlowItemCycle[] = [],
  flowDeps: FlowDependency[] = [],
  blockReasons: BlockReason[] = [],
  taskDeps: TaskDependencyEdge[] = [],
  flowInstanceRefs: TargetRef[] = [],
  expectations: Expectation[] = [],
  /** The title a delegated Task's wait is drawn with, from the Task's own and who holds it. */
  delegationWaitTitle: (taskTitle: string, delegateName: string | null) => string = (taskTitle) => taskTitle,
  /** The title a wait's check task is drawn with, from the wait's own: the settings' prefix. */
  checkTitle: (waitTitle: string) => string = (waitTitle) => waitTitle,
  /** How a Compound Task's derived block reads, in place of the backend's English. */
  compoundReason = "All open sub-items are blocked",
  /** How the agent capacity lock's derived reason reads, in place of the backend's English. */
  capacityReason = "Agents at capacity",
  /** How a Habit cooldown's derived reason reads, from the instant it lifts. */
  cooldownReason: (until: string) => string = (until) => `Cooling down until ${until}`,
  /** Each node's short id, keyed `task-12` / `expectation-3` (the load's `short_ids`). */
  shortIds: Readonly<Record<string, string>> = {},
  /** Every known Person's name, by id — what a Person delegate is called. */
  personNames: ReadonlyMap<number, string> = new Map(),
  /** What the board's rules say about each node beyond its row, keyed `task-12` (the load's
   * `facts`): which dependencies block it, what it inherits, its open question, whether it has
   * expired. */
  facts: Readonly<Record<string, NodeFacts>> = {},
  /** Every Flow's Commitment items and wait items (Task b66). */
  flowCommitments: FlowCommitment[] = [],
  flowExpectations: FlowExpectation[] = [],
): MindmapNode {
  const nodeMap = new Map<string, MindmapNode>();

  // Explicit block reasons, grouped per owner in stored (position) order. A reason the backend
  // derived — the agent capacity lock's, or a Compound Task's — is not the owner's to edit, so it is
  // kept apart, by its kind, and drawn among the virtual blockers in the app's own words; an editor
  // save then never writes it back as a stored reason.
  const manualBlockers = new Map<string, string[]>();
  const capacityBlocked = new Set<string>();
  const compoundBlocked = new Set<string>();
  const coolingUntil = new Map<string, string>();
  for (const br of blockReasons) {
    const key = `${br.owner_type}-${br.owner_id}`;
    if (br.derived === "cooldown") {
      if (br.until !== undefined) coolingUntil.set(key, br.until);
      continue;
    }
    if (br.derived === "agent_capacity") {
      capacityBlocked.add(key);
      continue;
    }
    if (br.derived === "compound") {
      compoundBlocked.add(key);
      continue;
    }
    const list = manualBlockers.get(key);
    if (list === undefined) manualBlockers.set(key, [br.reason]);
    else list.push(br.reason);
  }

  for (const domain of domains) {
    nodeMap.set(`domain-${domain.id}`, {
      id: `domain-${domain.id}`,
      rowId: domain.id,
      kind: subtypeToKind(domain.subtype),
      title: domain.title,
      position: domain.position,
      isPrivate: domain.is_private,
      ...(domain.color !== null ? { color: domain.color } : {}),
      ...(domain.status !== null ? { status: domain.status } : {}),
      ...(domain.knowledge_base_directory !== null ? { knowledgeBaseDirectory: domain.knowledge_base_directory } : {}),
      tagIds: [],
      children: [],
    });
  }

  for (const goal of goals) {
    nodeMap.set(`goal-${goal.id}`, {
      id: `goal-${goal.id}`,
      rowId: goal.id,
      origin: goal.origin ?? { kind: "manual" },
      kind: "goal",
      title: goal.title,
      status: goal.status,
      blockReasons: manualBlockers.get(`goal-${goal.id}`) ?? [],
      ...cooldownFields(coolingUntil.get(`goal-${goal.id}`), cooldownReason),
      timeScope: goal.time_scope,
      onScopeExit: goal.on_scope_exit,
      position: goal.position,
      isPrivate: goal.is_private,
      tagIds: goal.tag_ids,
      children: [],
    });
  }

  for (const task of tasks) {
    // A wait's check task is drawn with the settings' prefix; the row's own title is what its
    // editor edits.
    const isCheck = checkOrigin(task.origin) !== undefined;
    const taskCooldown = cooldownFields(coolingUntil.get(`task-${task.id}`), cooldownReason);
    nodeMap.set(`task-${task.id}`, {
      id: `task-${task.id}`,
      rowId: task.id,
      origin: task.origin ?? { kind: "manual" },
      kind: "task",
      title: isCheck ? checkTitle(task.title) : task.title,
      ...(isCheck ? { rowTitle: task.title } : {}),
      status: task.status.status,
      taskStatus: task.status,
      blockReasons: manualBlockers.get(`task-${task.id}`) ?? [],
      virtualBlockers: [
        ...(capacityBlocked.has(`task-${task.id}`) ? [capacityReason] : []),
        ...(compoundBlocked.has(`task-${task.id}`) ? [compoundReason] : []),
        ...(taskCooldown.virtualBlockers ?? []),
      ],
      ...(taskCooldown.coolingUntil !== undefined ? { coolingUntil: taskCooldown.coolingUntil } : {}),
      ...(capacityBlocked.has(`task-${task.id}`) ? { capacityBlocked: true } : {}),
      ...(compoundBlocked.has(`task-${task.id}`) ? { compoundBlocked: true } : {}),
      timeScope: task.time_scope,
      onScopeExit: task.on_scope_exit,
      plan: task.plan,
      dueScope: task.due_scope ?? null,
      backlogged: task.archival === TASK_ARCHIVAL.BACKLOG,
      ...(task.archival === TASK_ARCHIVAL.ARCHIVED ? { archivedByHand: true } : {}),
      agentic: task.agentic,
      delegate: task.delegate_to,
      ...personNameOf(task.delegate_to, personNames),
      asynchronous: task.asynchronous,
      ...(task.compound === true ? { compound: true } : {}),
      asyncTemplate: task.async_template ?? null,
      agenticBrief: task.agentic_brief ?? null,
      position: task.position,
      isPrivate: task.is_private,
      tagIds: task.tag_ids,
      children: [],
    });
  }

  for (const commitment of commitments) {
    nodeMap.set(`commitment-${commitment.id}`, {
      id: `commitment-${commitment.id}`,
      rowId: commitment.id,
      origin: commitment.origin ?? { kind: "manual" },
      kind: "commitment",
      title: commitment.title,
      verdict: commitment.verdict,
      verdictWindow: commitment.verdict_window ?? null,
      ...(commitment.archival === COMMITMENT_ARCHIVAL.ARCHIVED ? { archivedByHand: true } : {}),
      ...cooldownFields(coolingUntil.get(`commitment-${commitment.id}`), cooldownReason),
      timeScope: commitment.time_scope,
      position: commitment.position,
      isPrivate: commitment.is_private,
      tagIds: commitment.tag_ids,
      children: [],
    });
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const expectation of expectations) {
    const id = expectationNodeId(expectation.id);
    // A delegated Task's wait is drawn as what it waits on while its title is the Task's; one given
    // a title of its own is drawn with it. The row's title is what its editor edits.
    const holderTask = expectation.origin?.kind === "delegation_wait" ? taskById.get(expectation.parent_id) : undefined;
    const delegate = holderTask?.delegate_to ?? null;
    const labelled = delegate !== null && holderTask?.title === expectation.title;
    const delegateName = delegate === null ? null : personNames.get(delegate.id) ?? null;
    nodeMap.set(id, {
      id,
      rowId: expectation.id,
      origin: expectation.origin ?? { kind: "manual" },
      kind: "expectation",
      title: labelled ? delegationWaitTitle(expectation.title, delegateName) : expectation.title,
      ...(labelled ? { rowTitle: expectation.title } : {}),
      status: expectation.status,
      archived: expectation.archival === EXPECTATION_ARCHIVAL.ARCHIVED,
      checkEvery: expectation.check_every ?? null,
      checkStarting: expectation.check_starting ?? null,
      timeScope: expectation.time_scope,
      position: expectation.position,
      isPrivate: expectation.is_private,
      ...(expectation.agentic === true
        ? {
          agentWaiting: {
            note: expectation.agentic_note ?? null,
            question: expectation.question !== false,
            answer: expectation.answer ?? null,
          },
        }
        : {}),
      tagIds: expectation.tag_ids,
      children: [],
    });
  }

  // Each node's short id, which a "Blocked by …" reason names it by — read off the load by the key
  // the backend uses, which for a wait is not its node id.
  for (const [key, node] of nodeMap) {
    const shortId = shortIds[key];
    if (shortId !== undefined) node.shortId = shortId;
  }
  for (const expectation of expectations) {
    const node = nodeMap.get(expectationNodeId(expectation.id));
    const shortId = shortIds[`expectation-${expectation.id}`];
    if (node !== undefined && shortId !== undefined) node.shortId = shortId;
  }
  // Which waits each Task depends on, met or not: the editor's Dependencies field reads them.
  for (const dep of taskDeps) {
    if (dep.dependency_type !== "expectation") continue;
    const node = nodeMap.get(`task-${dep.task_id}`);
    if (node === undefined) continue;
    node.expectationDependencyIds = [...(node.expectationDependencyIds ?? []), dep.dependency_id];
  }
  // What the backend's rules say about each node (ADR 0010): the dependencies that block it, what
  // it inherits, its open question, whether it has expired. Drawn here, worded in the app's own
  // words, never worked out again.
  for (const [key, fact] of Object.entries(facts)) {
    const node = nodeMap.get(factNodeKey(key));
    if (node === undefined) continue;
    applyFacts(node, fact);
  }

  for (const info of infos) {
    nodeMap.set(`info-${info.id}`, {
      id: `info-${info.id}`,
      rowId: info.id,
      kind: "info",
      title: info.body,
      ...(info.details !== null ? { infoDetails: info.details } : {}),
      position: info.position,
      isPrivate: info.is_private,
      tagIds: [],
      children: [],
    });
  }

  for (const flow of flows) {
    nodeMap.set(`flow-${flow.id}`, {
      id: `flow-${flow.id}`,
      rowId: flow.id,
      kind: "flow",
      title: flow.title,
      position: flow.position,
      isPrivate: flow.is_private,
      flow: {
        instanceType: flow.instance_type,
        targetType: flow.target_type,
        targetId: flow.target_id,
        durationN: flow.flow_duration_n,
        durationKind: flow.flow_duration_kind,
        windowPart: flow.flow_window_part,
        windowTimeStart: flow.flow_window_time_start,
        windowTimeEnd: flow.flow_window_time_end,
        isHabit: flow.is_habit,
        rootPlanKind: flow.root_plan_kind,
        rootPlanStart: flow.root_plan_start,
        rootPlanEnd: flow.root_plan_end,
        verdictWindowN: flow.verdict_window_n,
        verdictWindowKind: flow.verdict_window_kind,
        template: templateFieldsOf(flow),
      },
      tagIds: [],
      children: [],
    });
  }

  // Flow items carry their owning flow's scope (to drive the relative cycle grid), plus the
  // relative cycle pairs and outgoing dependency edges attached to them.
  const flowById = new Map(flows.map((flow) => [flow.id, flow]));
  const cyclesByItem = new Map<string, FlowCyclePair[]>();
  for (const cycle of flowCycles) {
    const key = flowItemNodeId(cycle.item_type, cycle.item_id);
    (cyclesByItem.get(key) ?? cyclesByItem.set(key, []).get(key)!).push(toCyclePair(cycle));
  }
  const depsByItem = new Map<string, FlowItemDep[]>();
  for (const dep of flowDeps) {
    const key = flowItemNodeId(dep.dependent_type, dep.dependent_id);
    (depsByItem.get(key) ?? depsByItem.set(key, []).get(key)!).push({ type: dep.depends_on_type, id: dep.depends_on_id });
  }

  const buildFlowItem = (
    itemType: FlowItemType,
    item: FlowGoal | FlowTask | FlowCommitment | FlowExpectation,
  ): void => {
    const id = flowItemNodeId(itemType, item.id);
    const owningFlow = flowById.get(item.flow_id);
    nodeMap.set(id, {
      id,
      rowId: item.id,
      kind: itemType,
      title: item.title,
      position: item.position,
      isPrivate: item.is_private,
      flowItem: {
        itemType,
        flowId: item.flow_id,
        flowScopeN: owningFlow?.flow_duration_n ?? null,
        flowScopeKind: owningFlow?.flow_duration_kind ?? null,
        cycles: cyclesByItem.get(id) ?? [],
        dependsOn: depsByItem.get(id) ?? [],
        template: templateFieldsOf(item),
        ...("verdict_window" in item ? { verdictWindow: item.verdict_window } : {}),
        ...("check_every" in item ? { checkEvery: item.check_every, firstCheck: item.first_check } : {}),
      },
      tagIds: item.tag_ids ?? [],
      children: [],
    });
  };
  for (const goal of flowGoals) buildFlowItem("flow_goal", goal);
  for (const task of flowTasks) buildFlowItem("flow_task", task);
  for (const commitment of flowCommitments) buildFlowItem("flow_commitment", commitment);
  for (const wait of flowExpectations) buildFlowItem("flow_expectation", wait);

  // Wire flows to their parents.
  for (const flow of flows) {
    const flowNode = nodeMap.get(`flow-${flow.id}`);
    if (flowNode === undefined) continue;
    const parentKey =
      flow.parent_type === "goal" ? `goal-${flow.parent_id}` : `domain-${flow.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(flowNode);
    }
  }

  // Wire flow items under their flow or parent item.
  for (const goal of flowGoals) {
    const node = nodeMap.get(flowItemNodeId("flow_goal", goal.id));
    const parent = nodeMap.get(flowItemParentKey(goal.flow_id, goal.parent_type, goal.parent_id));
    if (node !== undefined && parent !== undefined) parent.children.push(node);
  }
  for (const task of flowTasks) {
    const node = nodeMap.get(flowItemNodeId("flow_task", task.id));
    const parent = nodeMap.get(flowItemParentKey(task.flow_id, task.parent_type, task.parent_id));
    if (node !== undefined && parent !== undefined) parent.children.push(node);
  }
  for (const [kind, items] of [
    ["flow_commitment", flowCommitments], ["flow_expectation", flowExpectations],
  ] as const) {
    for (const item of items) {
      const node = nodeMap.get(flowItemNodeId(kind, item.id));
      const parent = nodeMap.get(flowItemParentKey(item.flow_id, item.parent_type, item.parent_id));
      if (node !== undefined && parent !== undefined) parent.children.push(node);
    }
  }

  // Wire domain tree (all subtypes including tags)
  for (const domain of domains) {
    if (domain.parent_id === null) continue;
    const parentNode = nodeMap.get(`domain-${domain.parent_id}`);
    const selfNode = nodeMap.get(`domain-${domain.id}`);
    if (parentNode !== undefined && selfNode !== undefined) {
      parentNode.children.push(selfNode);
    }
  }

  // Wire goals to their parents
  for (const goal of goals) {
    const goalNode = nodeMap.get(`goal-${goal.id}`);
    if (goalNode === undefined) continue;
    const parentKey =
      goal.parent_type === "goal"
        ? `goal-${goal.parent_id}`
        : `domain-${goal.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(goalNode);
    }
  }

  // Wire tasks to their parents
  for (const task of tasks) {
    const taskNode = nodeMap.get(`task-${task.id}`);
    if (taskNode === undefined) continue;
    const parentNode = nodeMap.get(contentParentKey(task.parent_type, task.parent_id));
    if (parentNode !== undefined) {
      parentNode.children.push(taskNode);
    }
  }

  // Wire commitments to their parents — the same four spellings a task's parent link can take.
  for (const commitment of commitments) {
    const node = nodeMap.get(`commitment-${commitment.id}`);
    if (node === undefined) continue;
    const parentNode = nodeMap.get(contentParentKey(commitment.parent_type, commitment.parent_id));
    if (parentNode !== undefined) {
      parentNode.children.push(node);
    }
  }

  // Wire expectations to their parents — the same four spellings a task's parent link can take.
  for (const expectation of expectations) {
    const node = nodeMap.get(expectationNodeId(expectation.id));
    if (node === undefined) continue;
    nodeMap.get(contentParentKey(expectation.parent_type, expectation.parent_id))?.children.push(node);
  }

  // Wire info nodes to their parents
  for (const info of infos) {
    const infoNode = nodeMap.get(`info-${info.id}`);
    if (infoNode === undefined) continue;
    const parentNode = nodeMap.get(infoParentKey(info));
    if (parentNode !== undefined) {
      parentNode.children.push(infoNode);
    }
  }

  // Flag real Goal/Task nodes materialized by a started flow (drives the flow-instance badge).
  for (const ref of flowInstanceRefs) {
    const node = nodeMap.get(`${ref.node_type}-${ref.node_id}`);
    if (node !== undefined) node.fromFlow = true;
  }

  // Sort each parent's children by position so mixed-type siblings
  // (e.g. goals and tasks under the same project) respect insertion order
  // rather than being grouped by entity type.
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.position - b.position);
  }

  const aspectNodes = domains
    .filter((d) => d.subtype === "aspect")
    .map((d) => nodeMap.get(`domain-${d.id}`)!)
    .filter((n) => n !== undefined)
    .sort((a, b) => a.position - b.position);

  const root = { ...VIRTUAL_ROOT, children: aspectNodes };
  propagateAspectColor(root, undefined);
  return root;
}

/** One flow whose Habit iterations failed to derive, as the banner needs it. */
export interface FailedFlow {
  id: number;
  title: string;
}

/**
 * A background load condition: something the current load's data got wrong that the user did
 * not cause, about a node that may be anywhere on the tree. Distinct from `error` (the load
 * failed entirely) and from a `PendingToast` (something the user just did, anchored on the node
 * they did it to) — a failed Habit derivation means the tree is *currently showing wrong data*,
 * which calls for a persistent banner rather than a toast that fades while the data stays wrong.
 */
export interface LoadCondition {
  failedFlows: FailedFlow[];
  /**
   * Habits that materialize Commitments but whose template holds Goal items, so no iteration of
   * them can be drawn (see {@link holdsUnrenderableGoalItems}).
   */
  unrenderableCommitmentFlows: FailedFlow[];
}

const NO_CONDITIONS: LoadCondition = { failedFlows: [], unrenderableCommitmentFlows: [] };

/**
 * Collects everything this load got wrong that the user did not cause: the flows whose Habit
 * iterations failed to derive, and the commitment Habits whose template cannot be rendered.
 *
 * Derivation failures used to be swallowed by a per-call `.catch(() => [])`, which made a failed
 * derivation indistinguishable from a flow that genuinely has none. The envelope now carries the
 * reason per flow. Every one is listed — there is no "name the first, count the rest" compromise
 * here; that compromise only ever existed because a single toast slot was the only vehicle for it.
 * The same holds for an unrenderable template: iterations that are not drawn are always said.
 */
function collectLoadConditions(data: MindmapLoad): LoadCondition {
  const failedFlows = data.habits
    .filter((entry) => entry.result.outcome === "failed")
    .map((entry) => ({ id: entry.flow_id, title: entry.flow_title }));
  const unrenderableCommitmentFlows = data.flows
    .filter((flow) => flow.is_habit && holdsUnrenderableGoalItems(flow, data.flow_goals))
    .map((flow) => ({ id: flow.id, title: flow.title }));
  return failedFlows.length === 0 && unrenderableCommitmentFlows.length === 0
    ? NO_CONDITIONS
    : { failedFlows, unrenderableCommitmentFlows };
}

/**
 * The window fields an editor-configured commitment carries, omitted when it named none.
 *
 * Absent is not the same as `null` here: absent inherits the window above, which for an occurrence
 * child is the occurrence's own — the one the backend gives it when it names none.
 */
function commitmentWindow(data: CommitmentSaveData): {
  time_scope?: TimeScope;
  verdict_window?: DurationSpec;
} {
  return {
    ...(data.timeScope !== null ? { time_scope: data.timeScope } : {}),
    ...(data.verdictWindow !== null ? { verdict_window: data.verdictWindow } : {}),
  };
}

/**
 * Writes a commitment configured in the editor under its parent — a stored row, or a Habit
 * occurrence, which the backend writes it onto like any other parent.
 */
async function createCommitmentUnderNode(
  parentRowId: RowId,
  parentKind: NodeKind,
  data: CommitmentSaveData,
): Promise<RowId> {
  const commitment = await createCommitment({
    title: data.title,
    parent_type: kindToParentType(parentKind),
    parent_id: parentRowId,
    verdict: data.verdict,
    ...commitmentWindow(data),
  });
  if (data.isPrivate) await updateCommitment(commitment.id, { is_private: true });
  return commitment.id;
}

/** Every Person's name, by id. A failed read draws a Person delegate unnamed rather than failing
 * the board, as a failed MCP read draws no antenna. */
async function loadPersonNames(): Promise<Map<number, string>> {
  // People are Standalone-only: a server has none to name (docs/spec/client-mode.md).
  if (isClientMode(useClientModeStore.getState().status)) return new Map();
  try {
    const people = await listPeople();
    return new Map((people ?? []).map((person) => [person.id, person.name]));
  } catch (error: unknown) {
    console.warn("[arlesh] could not read people's names:", error);
    return new Map();
  }
}

/** A board as the server gave it, with the stamp of the read it came from. */
interface LoadedBoard {
  tree: MindmapNode;
  stamp: BoardStamp;
}

const NOTHING_LOADED: LoadedBoard = { tree: VIRTUAL_ROOT, stamp: { read: 0, epoch: null, revision: null } };

export function useMindmapData(): MindmapData {
  const { t } = useTranslation(["undo", "expectation", "editor", "habits", "warnings", "nodeKinds"]);
  const showToast = useMindmapStore((s) => s.showToast);
  const enqueueWrite = usePendingWrite({ showToast });
  const readOnlyNotice = useReadOnlyNotice();
  // The board as the server last gave it, and the stamp of the read it came from. What the views
  // get is this with the window's pending writes drawn over it (ADR 0012, decision 3).
  const [loaded, setLoaded] = useState<LoadedBoard>(NOTHING_LOADED);
  const boardId = useId();
  const pendingWrites = usePendingWritesStore((s) => s.writes);
  const pendingAliases = usePendingWritesStore((s) => s.aliases);
  const tree = useMemo(
    () => applyPendingWrites(loaded.tree, loaded.stamp, pendingWrites, pendingAliases),
    [loaded, pendingWrites, pendingAliases],
  );
  // Read through a ref, set in an effect, so `load` does not change identity with `t` — which
  // would re-run the mount effect and reload for nothing. Declared before that effect, so the
  // first load already has it.
  const delegationWaitTitle = useRef((title: string, _delegateName: string | null) => title);
  const capacityReason = useRef("Agents at capacity");
  const carriesMissedTitle = useRef<CarriesMissedTitle>(({ title, scope }) => `${title} ${scope}`);
  const compoundReason = useRef("All open sub-items are blocked");
  const cooldownReason = useRef((until: string) => `Cooling down until ${until}`);
  useEffect(() => {
    delegationWaitTitle.current = (title: string, delegateName: string | null) => t("expectation:delegationWaitTitle", {
      title,
      delegate: delegateName ?? t("expectation:delegatePersonUnnamed"),
    });
    capacityReason.current = t("editor:agentsAtCapacity");
    carriesMissedTitle.current = (parts) => t("habits:carriesMissed", parts);
    compoundReason.current = t("editor:compoundBlocked");
    cooldownReason.current = (until: string) => t("editor:cooldownBlocked", { when: formatCooldownUntil(until) });
  }, [t]);
  // A check task is titled `{prefix}{wait title}`, the prefix a display setting. Unlike the
  // translation above it is a dependency of `load`: changing it redraws the board with the new
  // titles rather than leaving them stale until the next edit.
  const storedCheckPrefix = useDisplayStore((s) => s.checkTaskPrefix);
  const checkPrefix = storedCheckPrefix ?? t("expectation:checkTaskPrefixDefault");
  // The tree as of the latest load, read synchronously by the mutations to resolve a node id to
  // its row. A ref rather than the `tree` closure: a caller that creates a node and acts on it in
  // the same gesture holds a callback from before the reload that drew it.
  // It holds the **patched** tree, so a second press predicts from the first, and is worked out on
  // demand from the store rather than set by an effect, which would lag a gesture's second call.
  const latestLoaded = useRef<LoadedBoard>(NOTHING_LOADED);
  const latestPatched = useRef<{ loaded: LoadedBoard; writes: unknown; aliases: unknown; tree: MindmapNode } | null>(null);
  const currentTree = useCallback((): MindmapNode => {
    const { writes, aliases } = usePendingWritesStore.getState();
    const cached = latestPatched.current;
    if (cached !== null && cached.loaded === latestLoaded.current && cached.writes === writes && cached.aliases === aliases) {
      return cached.tree;
    }
    const patched = applyPendingWrites(latestLoaded.current.tree, latestLoaded.current.stamp, writes, aliases);
    latestPatched.current = { loaded: latestLoaded.current, writes, aliases, tree: patched };
    return patched;
  }, []);
  // A temporary id (a node still being created) is looked up under the real one once it has one.
  const rowIdOfId = useCallback(
    (nodeId: string): RowId => rowIdOfNodeId(currentTree(), usePendingWritesStore.getState().resolveId(nodeId)),
    [currentTree],
  );
  // This tab's selection and collapsed nodes follow a created node from its temporary id to its real
  // one, and let go of a placeholder whose create was refused or cancelled (decision 8).
  useTemporaryIds({
    onResolved: (temporaryId, realId) => { useMindmapStore.getState().renameNodeId(temporaryId, realId); },
    onRemoved: (removed) => {
      const parent = removed[0]?.parentId ?? null;
      useMindmapStore.getState().dropNodeIds(new Set(removed.map((node) => node.id)), parent);
    },
  });
  // The newest read this hook has started, and the newest it has put on screen: a read that returns
  // after a newer one has been drawn is discarded.
  const startedRead = useRef(0);
  const drawnRead = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadCondition, setLoadCondition] = useState<LoadCondition>(NO_CONDITIONS);
  const scopeLabels = useScopeLabels();

  /**
   * Loads the whole mindmap and rebuilds the tree.
   *
   * `showSpinner` is the only thing separating the initial load from the refresh every mutation
   * ends with: a mutation keeps the canvas mounted so pan/zoom survives. The fetch is one round
   * trip either way — `load_mindmap` resolves the per-flow Habit wave backend-side.
   */
  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setIsLoading(true);
      setError(null);
      try {
        const now = localNowIso();
        const read = usePendingWritesStore.getState().beginRead();
        startedRead.current = read;
        useBoardRevisionStore.getState().loadStarted();
        let data: MindmapLoad;
        try {
          data = await loadMindmap(now);
        } catch (err) {
          useBoardRevisionStore.getState().loadFailed();
          throw err;
        }
        useBoardRevisionStore.getState().loadFinished(data.revision ?? null);
        if (read < drawnRead.current) return;
        // People are read only when a Task is delegated to one: their names are what a Person
        // delegate's badge and wait are labelled with, and nothing else on the board needs them.
        const personNames = data.tasks.some((task) => task.delegate_to != null)
          ? await loadPersonNames()
          : new Map<number, string>();
        const built = buildTree(
          data.domains, data.goals, data.tasks, data.infos, data.commitments, data.flows,
          data.flow_goals, data.flow_tasks, data.flow_cycles, data.flow_dependencies,
          data.block_reasons, data.task_dependencies, data.flow_instance_nodes,
          data.expectations, (title, delegateName) => delegationWaitTitle.current(title, delegateName),
          (title) => `${checkPrefix}${title}`, compoundReason.current, capacityReason.current,
          (until) => cooldownReason.current(until), data.short_ids ?? {}, personNames, data.facts ?? {},
          data.flow_commitments ?? [], data.flow_expectations ?? [],
        );
        applyLifecycles(built, lifecycleMap(data.lifecycles));
        // A Habit's occurrences are ordinary rows, already built into the tree above. A flow whose
        // derivation failed has none, and says so as a load condition below — it is not silently
        // indistinguishable from a flow that simply has no iterations.
        decorateIterationRoots(built, data.flows, scopeLabels, now, (parts) => carriesMissedTitle.current(parts));
        drawnRead.current = read;
        const next: LoadedBoard = {
          tree: built,
          stamp: { read, epoch: data.revision?.epoch ?? null, revision: data.revision?.revision ?? null },
        };
        latestLoaded.current = next;
        setLoaded(next);
        // The whole board, before any view narrows it to a subtree: the top bar's agent status.
        useAgentActivityStore.getState().receive(agentActivityFrom(data.agent_activity));
        setLoadCondition(collectLoadConditions(data));
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (showSpinner) setIsLoading(false);
      }
    },
    [scopeLabels, checkPrefix],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  // The window's store retires a pending write once every board has caught up with it, so it has
  // to hear which board this is.
  useEffect(() => {
    usePendingWritesStore.getState().reportBoard(boardId, loaded.stamp);
  }, [boardId, loaded.stamp]);
  useEffect(() => () => usePendingWritesStore.getState().forgetBoard(boardId), [boardId]);

  // After an answer the board reloads, unless it already reflects the write (decision 5). Reloads
  // coalesce: one in flight and one waiting.
  const reloading = useRef(false);
  const reloadAgain = useRef(false);
  const reloadForAnswers = useCallback(async () => {
    if (reloading.current) {
      reloadAgain.current = true;
      return;
    }
    reloading.current = true;
    try {
      do {
        reloadAgain.current = false;
        await load(false);
      } while (reloadAgain.current);
    } finally {
      reloading.current = false;
    }
  }, [load]);
  useEffect(() => {
    // An answer needs a read only if no read has begun since it arrived: a read in flight will
    // carry it, and its landing is judged by the stamp.
    const unreflected = pendingWrites.some(
      ({ answer }) => answer !== null && answer.afterRead >= startedRead.current && !isReflected(answer, loaded.stamp),
    );
    if (unreflected) void reloadForAnswers();
  }, [pendingWrites, loaded.stamp, reloadForAnswers]);

  // A change to the MCP roots made in this window redraws the "visible to the MCP" badges. Not a
  // dependency of `load`, which would raise the full-screen spinner for it; the initial load
  // already read the roots, so only a later change reloads.
  const mcpRevision = useMcpAccessStore((s) => s.revision);
  const seenMcpRevision = useRef(mcpRevision);
  useEffect(() => {
    if (seenMcpRevision.current === mcpRevision) return;
    seenMcpRevision.current = mcpRevision;
    void load(false);
  }, [mcpRevision, load]);

  /** The kind of node Tab makes under `parentId`, and *insert parent* makes above a node. */
  const defaultChildKind = useCallback(
    (parentId: string, parentKind: NodeKind): NodeKind => {
      // A flow root spawns items of its Instance Type; a flow item spawns items of its own kind.
      const flowRootChildKind = (): NodeKind =>
        findNodeInTree(tree, parentId)?.flow?.instanceType === "goal" ? "flow_goal" : "flow_task";
      return (
        parentKind === "info" ? "info"
        : parentKind === "project" ? "project"
        : parentKind === "goal" ? "goal"
        : parentKind === "task" ? "task"
        // A commitment's default child is another commitment: the common shape is a month
        // holding each day's instance, not a month holding a chore.
        : parentKind === "commitment" ? "commitment"
        : parentKind === "flow" ? flowRootChildKind()
        : parentKind === "flow_goal" ? "flow_goal"
        : parentKind === "flow_task" ? "flow_task"
        // A Commitment item's default child is another, as a Commitment's is.
        : parentKind === "flow_commitment" ? "flow_commitment"
        // A Tag holds notes about itself and nothing else (Arlesh-71m taught `isValidDropTarget`
        // that and left this table behind), so its default child is the only child it can take.
        : parentKind === "tag" ? "info"
        : "domain" // aspect, domain → domain
      );
    },
    [tree],
  );

  /**
   * What sending one create does: posts it and answers with the real node the server made. The
   * parent is named by the id the user's gesture held, and resolved to its row when the create is
   * sent, so a parent that is itself a placeholder has its real id by then (decision 8).
   */
  const createSender = useCallback(
    (
      parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string,
      agentic: TaskAgentic | undefined, infoPosition: number,
    ): (() => Promise<MindmapNode>) => {
      if (childKind === "domain" || childKind === "project" || childKind === "tag") {
        return async () => {
          const domain = await createDomain({
            title, description: null, subtype: childKind,
            parent_id: storedId(rowIdOfId(parentId)), status: null, knowledge_base_directory: null,
          });
          return {
            id: `domain-${domain.id}`, rowId: domain.id, kind: childKind, title: domain.title,
            position: domain.position, tagIds: [], children: [],
          };
        };
      }
      if (childKind === "goal") {
        return async () => {
          const goal = await createGoal({ title, parent_type: kindToParentType(parentKind), parent_id: rowIdOfId(parentId) });
          return {
            id: `goal-${goal.id}`, rowId: goal.id, kind: "goal", title: goal.title,
            status: goal.status, position: goal.position, tagIds: [], children: [],
          };
        };
      }
      if (childKind === "task") {
        return async () => {
          // Spread rather than passed as `agentic: agentic`: under `exactOptionalPropertyTypes` an
          // explicit `undefined` is not the same as an absent field, and absent is what "no opinion,
          // take the default" has to send.
          const task = await createTask({
            title, parent_type: kindToParentType(parentKind), parent_id: rowIdOfId(parentId),
            ...(agentic !== undefined ? { agentic } : {}),
          });
          return {
            id: `task-${task.id}`, rowId: task.id, kind: "task", title: task.title,
            status: task.status.status, taskStatus: task.status, position: task.position, tagIds: [], children: [],
          };
        };
      }
      if (childKind === "commitment") {
        // No Time Scope is sent: a fresh commitment inherits the window above it, and the
        // backend refuses it outright when there is none — a rule that can never come due is
        // not something to create and fix up later.
        return async () => {
          const commitment = await createCommitment({
            title, parent_type: kindToParentType(parentKind), parent_id: rowIdOfId(parentId),
          });
          return {
            id: `commitment-${commitment.id}`, rowId: commitment.id, kind: "commitment", title: commitment.title,
            verdict: commitment.verdict, position: commitment.position, tagIds: [], children: [],
          };
        };
      }
      if (childKind === "expectation") {
        return async () => {
          const expectation = await createExpectation({
            title, parent_type: kindToParentType(parentKind), parent_id: rowIdOfId(parentId),
          });
          return {
            id: expectationNodeId(expectation.id), rowId: expectation.id, kind: "expectation",
            title: expectation.title, status: expectation.status, checkEvery: expectation.check_every ?? null,
            position: expectation.position, tagIds: [], children: [],
          };
        };
      }
      if (childKind === "info") {
        return async () => {
          const info = await createInfo({
            body: title, parent_type: kindToInfoParentType(parentKind),
            parent_id: rowIdOfId(parentId), position: infoPosition,
          });
          return {
            id: `info-${info.id}`, rowId: info.id, kind: "info", title: info.body,
            position: info.position, tagIds: [], children: [],
          };
        };
      }
      if (isFlowItemType(childKind)) {
        return async () => {
          // A flow item's owning flow is the parent flow node, or the parent item's flow.
          const dbParentId = rowIdOfId(parentId);
          const parent = findNodeInTree(currentTree(), usePendingWritesStore.getState().resolveId(parentId));
          const flowId = parent?.kind === "flow" ? dbParentId : parent?.flowItem?.flowId;
          if (flowId === undefined) throw new Error(`Cannot create a flow item under "${parentId}"`);
          const parentType = parentKind === "flow" ? "flow" : parentKind;
          const request = { flow_id: storedId(flowId), title, parent_type: parentType, parent_id: storedId(dbParentId) };
          const item = await createFlowItem(childKind, request);
          return {
            id: flowItemNodeId(childKind, item.id),
            rowId: item.id,
            kind: childKind, title: item.title,
            position: item.position, tagIds: [], children: [],
          };
        };
      }
      throw new Error(`Cannot create a node of kind "${childKind}"`);
    },
    [rowIdOfId, currentTree],
  );

  // A create shows at once as a placeholder under a temporary id and goes through the window's lane
  // (ADR 0012, decision 8): a rename, a status step or a child queued behind it names the temporary
  // id and is sent with the real one. The one rule it runs locally is the pinned parenting rule. It
  // answers with the placeholder, at once; the lane settles it. A parent that cannot hold the kind,
  // and a board that is read only, are refused here by throwing, before any patch, as the write
  // itself was refused before.
  const createNode = useCallback(
    async (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string, agentic?: TaskAgentic): Promise<MindmapNode> => {
      const parent = findNodeInTree(currentTree(), parentId);
      const sender = createSender(
        parentId, parentKind, childKind, title, agentic,
        // The next place among the parent's children, read now: an Info is the one kind that names its place.
        (parent?.children ?? []).reduce((m, c) => Math.max(m, c.position), -1) + 1,
      );
      if (parent !== undefined && !canParentNewChild(parent, childKind)) {
        throw new Error(t("warnings:typedChildRefused", {
          child: t(`nodeKinds:${childKind}`),
          parent: t(`nodeKinds:${parent.kind}`),
          parents: validParentKinds(childKind).map((kind) => t(`nodeKinds:${kind}`)).join(", "),
        }));
      }
      const store = usePendingWritesStore.getState();
      const placeholder: MindmapNode = {
        id: store.nextTemporaryId(), kind: childKind, title, position: 0, tagIds: [], children: [], pending: true,
      };
      const enqueued = enqueueWrite({
        nodeId: placeholder.id,
        label: "create",
        patch: { kind: "create", parentId, afterId: null, node: { id: placeholder.id, kind: childKind, title } },
        refuseReadOnly: () => undefined,
        refusalToast: (message) => t("warnings:createFailed", { message }),
        send: async () => createdWrite(await sender()),
      });
      if (!enqueued) throw new Error(readOnlyNotice());
      return placeholder;
    },
    [createSender, currentTree, enqueueWrite, readOnlyNotice, t],
  );

  /**
   * Waits for a created node's real row to be on the board, and answers with it, or `undefined`
   * when the create was refused. For a caller that needs the node itself and not its placeholder
   * (the Steps View's editor), so it stays write-then-reload.
   */
  const settleCreated = useCallback(
    async (placeholder: MindmapNode): Promise<MindmapNode | undefined> => {
      await usePendingWritesStore.getState().whenDrained();
      await load(false);
      return findNodeInTree(currentTree(), usePendingWritesStore.getState().resolveId(placeholder.id));
    },
    [load, currentTree],
  );

  const createChild = useCallback(
    async (parentId: string, parentKind: NodeKind, title: string): Promise<MindmapNode> => {
      const childKind = defaultChildKind(parentId, parentKind);
      return createNode(parentId, parentKind, childKind, title);
    },
    [createNode, defaultChildKind],
  );

  // A rename shows at once and goes through the window's lane (ADR 0012): the title is the only
  // field it writes, so there is no rule to pin. A Flow or a flow item stays write-then-reload
  // (decision 16), behind whatever the lane still holds. Resolves once the rename is handed on.
  const renameNode = useCallback(
    async (id: string, kind: NodeKind, title: string): Promise<void> => {
      if (kind === "flow" || isFlowItemType(kind)) {
        await awaitLane();
        const dbId = rowIdOfId(id);
        if (kind === "flow") await updateFlow(storedId(dbId), { title });
        else if (isFlowItemType(kind)) await updateFlowItem(kind, storedId(dbId), { title });
        await load(false);
        return;
      }
      const node = findNodeInTree(currentTree(), id);
      const shown = node === undefined ? title : shownTitle(node, title);
      enqueueWrite({
        nodeId: id,
        label: "rename",
        patch: { kind: "fields", fields: { title: shown } },
        refuseReadOnly: () => {
          showToast({ nodeId: id, message: t("warnings:renameFailed", { message: readOnlyNotice() }) });
        },
        refusalToast: (message) => t("warnings:renameFailed", { message }),
        send: async () => {
          const dbId = rowIdOfId(id);
          if (kind === "goal") await updateGoal(dbId, { title });
          else if (kind === "task") await updateTask(dbId, { title });
          else if (kind === "commitment") await updateCommitment(dbId, { title });
          else if (kind === "expectation") await updateExpectation(dbId, { title });
          else if (kind === "info") await updateInfo(storedId(dbId), { body: title });
          else await updateDomain(storedId(dbId), { title });
          return writtenWith({ title: shown });
        },
      });
    },
    [load, rowIdOfId, currentTree, enqueueWrite, showToast, readOnlyNotice, t],
  );

  const reorderNode = useCallback(
    async (id: string, direction: 1 | -1): Promise<void> => {
      await awaitLane();
      const parent = findParentInTree(tree, id);
      if (parent === undefined) return;

      const siblings = parent.children;
      const idx = siblings.findIndex((s) => s.id === id);
      if (idx === -1) return;

      const neighborIdx = idx + direction;
      if (neighborIdx < 0 || neighborIdx >= siblings.length) return;

      const node = siblings[idx]!;
      const neighbor = siblings[neighborIdx]!;
      const nodeDbId = rowIdOf(node);
      const neighborDbId = rowIdOf(neighbor);
      const nodePos = node.position;
      const neighborPos = neighbor.position;

      // Swap positions, dispatching to the correct table for each node.
      const setPos = async (nId: RowId, kind: NodeKind, pos: number): Promise<void> => {
        if (kind === "goal") await updateGoal(nId, { position: pos });
        else if (kind === "task") await updateTask(nId, { position: pos });
        else if (kind === "commitment") await updateCommitment(nId, { position: pos });
        else if (kind === "expectation") await updateExpectation(nId, { position: pos });
        else if (kind === "info") await updateInfo(storedId(nId), { position: pos });
        else if (isFlowItemType(kind)) await updateFlowItem(kind, storedId(nId), { position: pos });
        else if (kind === "flow") await updateFlow(storedId(nId), { position: pos });
        else await updateDomain(storedId(nId), { position: pos });
      };

      await Promise.all([
        setPos(nodeDbId, node.kind, neighborPos),
        setPos(neighborDbId, neighbor.kind, nodePos),
      ]);
      await load(false);
    },
    [load, tree],
  );

  const moveNode = useCallback(
    async (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number): Promise<void> => {
      await awaitLane();
      const dbId = rowIdOfId(id);
      const dbParentId = rowIdOfId(newParentId);
      // Exhaustive over NodeKind on purpose. Node ids are polymorphic — a flow and a domain can
      // share the number 5 — so a kind with no branch of its own must be a compile error, not a
      // fall-through that hands the id to whichever table the default happens to name.
      switch (kind) {
        case "goal":
          await updateGoal(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "task":
          await updateTask(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "commitment":
          await updateCommitment(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "expectation":
          await updateExpectation(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "info":
          await updateInfo(storedId(dbId), { parent_type: kindToInfoParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "flow": {
          const request: UpdateFlowRequest = {
            parent_type: kindToFlowParentType(newParentKind),
            parent_id: storedId(dbParentId),
            position,
          };
          // The Target Node is not touched. A flow with no explicit target resolves to its parent
          // on read, so the instances follow the move by construction; a target pointed elsewhere
          // was chosen deliberately and stays where it was put.
          await updateFlow(storedId(dbId), request);
          break;
        }
        case "flow_goal":
        case "flow_task":
        case "flow_commitment":
        case "flow_expectation": {
          // Flow items move only within their flow subtree; parent is the flow or another item.
          const parentType = newParentKind === "flow" ? "flow" : newParentKind;
          await updateFlowItem(kind, storedId(dbId), { parent_type: parentType, parent_id: storedId(dbParentId), position });
          break;
        }
        case "domain":
        case "project":
        case "tag":
          await updateDomain(storedId(dbId), { parent_id: storedId(dbParentId), position });
          break;
        case "aspect":
          // Aspects are the roots of the board. `isValidDropTarget` refuses to drop one, so
          // reaching here means a caller skipped that check — say so instead of quietly
          // giving the aspect a parent and demoting it.
          throw new Error("Aspects are top level and cannot be moved");
        case "habit_group":
          // A display node standing in for iterations, with nothing of its own to move.
          throw new Error("A folded Habit history cannot be moved");
        default: {
          // `kind` is `never` here only while every NodeKind is handled above. Adding a kind
          // without a branch fails this assignment at compile time — which is the whole point:
          // the old `else` swallowed exactly that mistake and wrote it to the domains table.
          const unhandled: never = kind;
          throw new Error(`moveNode has no branch for node kind "${String(unhandled)}"`);
        }
      }
      await load(false);
    },
    [load, rowIdOfId],
  );

  /**
   * Deep-clones `id`'s whole subtree under `(targetId, targetKind)`, placing the new root at
   * `position` — the COPY counterpart to `moveNode`'s CUT. A Commitment has no duplicate command
   * of its own; callers filter those out before getting here (`onPaste` does, with a toast).
   *
   * Resolves with the rows hung on Habit occurrences inside the copy that it could not carry, for
   * the paste to name. A Flow or flow item copied on its own leaves none behind.
   */
  const duplicateNode = useCallback(
    async (id: string, kind: NodeKind, targetId: string, targetKind: NodeKind, position: number): Promise<readonly LeftBehindChild[]> => {
      await awaitLane();
      // A copy is a stored row made from a stored one: an occurrence is its template's, in its
      // iteration, and has no copy of its own to make; and none is pasted onto one.
      const dbId = storedId(rowIdOfId(id));
      const dbTargetId = storedId(rowIdOfId(targetId));
      // Exhaustive over NodeKind, for the same reason `moveNode` is: node ids are polymorphic, so a
      // kind with no branch of its own must be a compile error rather than a fall-through that
      // hands the id to whichever table the default happens to name.
      let leftBehind: readonly LeftBehindChild[] = [];
      switch (kind) {
        case "goal":
          leftBehind = (await duplicateGoal(dbId, kindToParentType(targetKind), dbTargetId, position)).left_behind;
          break;
        case "task":
          leftBehind = (await duplicateTask(dbId, kindToParentType(targetKind), dbTargetId, position)).left_behind;
          break;
        case "commitment":
          // A Commitment has no duplicate command of its own yet, and copying one would have to
          // decide what a copy of a recorded Verdict means. Refused by name rather than routed
          // into whichever table the fall-through happened to pick.
          throw new Error("commitment nodes cannot be duplicated");
        case "expectation":
          // No duplicate command either: `onPaste` refuses a copied wait by name before this.
          throw new Error("expectation nodes cannot be duplicated");
        case "info":
          leftBehind = (await duplicateInfo(dbId, kindToInfoParentType(targetKind), dbTargetId, position)).left_behind;
          break;
        case "project":
        case "domain":
        case "tag":
          leftBehind = (await duplicateDomain(dbId, dbTargetId, position)).left_behind;
          break;
        case "aspect":
          // Aspects are the fixed roots of the board — there is no second Green.
          throw new Error("Aspects are fixed and cannot be duplicated");
        case "flow":
          // Template, cycle pairs, dependencies and Recurrence — a copy of a Habit is a Habit. The
          // Target Node is inherited as stored, so a flow that never named one targets wherever it
          // was pasted. No completion history and no started instances travel with it.
          await duplicateFlow(dbId, kindToFlowParentType(targetKind), dbTargetId, position);
          break;
        case "flow_goal":
        case "flow_task":
        case "flow_commitment":
        case "flow_expectation":
          // Within the flow only — `onPaste` refuses the cross-flow case before getting here, and
          // the backend refuses it again: the Cycle Scope is an offset into *this* flow's window.
          await duplicateFlowItem(kind, dbId, kindToFlowItemParentType(targetKind), dbTargetId, position);
          break;
        case "habit_group":
          throw new Error("A folded Habit history cannot be duplicated");
        default: {
          const unhandled: never = kind;
          throw new Error(`duplicateNode has no branch for node kind "${String(unhandled)}"`);
        }
      }
      await load(false);
      return leftBehind;
    },
    [load, rowIdOfId],
  );

  /**
   * Copies (`copy`) or moves `items` under `(targetId, targetKind)` from `position` on, as **one**
   * gesture operation (`paste`): one transaction and one undo step, here and against a server.
   * Resolves with the rows hung on Habit occurrences that the copies could not carry.
   */
  /**
   * *Insert parent*: makes a node of the default kind under `parentId`, then moves `nodeId` under
   * it, as **one** gesture operation. Resolves with the new node's id.
   */
  const insertParent = useCallback(
    async (nodeId: string, kind: NodeKind, parentId: string, parentKind: NodeKind): Promise<string> => {
      await awaitLane();
      const childKind = defaultChildKind(parentId, parentKind);
      const parent = rowIdOfId(parentId);
      const link = kindToParentType(parentKind);
      const create = ((): GestureStep => {
        switch (childKind) {
          case "domain": case "project": case "tag":
            return { op: "create_domain", request: { title: "", description: null, subtype: childKind, parent_id: storedId(parent), status: null, knowledge_base_directory: null } };
          case "goal": return { op: "create_goal", request: { title: "", parent_type: link, parent_id: parent } };
          case "task": return { op: "create_task", request: { title: "", parent_type: link, parent_id: parent } };
          case "commitment": return { op: "create_commitment", request: { title: "", parent_type: link, parent_id: parent } };
          case "info": return { op: "create_info", request: { body: "", parent_type: kindToInfoParentType(parentKind), parent_id: parent, position: 0 } };
          case "flow_goal": case "flow_task": case "flow_commitment": case "flow_expectation": {
            const node = findNodeInTree(tree, parentId);
            const flowId = node?.kind === "flow" ? parent : node?.flowItem?.flowId;
            if (flowId === undefined) throw new Error(`Cannot create a flow item under "${parentId}"`);
            return { op: "create_flow_item", item_type: childKind, request: { flow_id: storedId(flowId), title: "", parent_type: parentKind, parent_id: storedId(parent) } };
          }
          default: throw new Error(`Cannot insert a parent of kind "${childKind}"`);
        }
      })();
      const answers = await runGesture("insert-parent", [
        create,
        { op: "move", kind, id: rowIdOfId(nodeId), parent_kind: childKind, parent: { step: 0 }, position: 0 },
      ]);
      const made = answers[0];
      const id: unknown = typeof made === "object" && made !== null ? Reflect.get(made, "id") : undefined;
      if (typeof id !== "number") throw new Error("insert parent made no node");
      await load(false);
      if (childKind === "domain" || childKind === "project" || childKind === "tag") return `domain-${id}`;
      if (isFlowItemType(childKind)) return flowItemNodeId(childKind, id);
      return `${childKind}-${id}`;
    },
    [defaultChildKind, load, rowIdOfId, tree],
  );

  const pasteNodes = useCallback(
    async (
      items: ReadonlyArray<{ id: string; kind: NodeKind }>, targetId: string, targetKind: NodeKind,
      position: number, copy: boolean,
    ): Promise<readonly LeftBehindChild[]> => {
      await awaitLane();
      const target = rowIdOfId(targetId);
      const steps: GestureStep[] = items.map(({ id, kind }, index) => copy
        ? { op: "duplicate", kind, id: storedId(rowIdOfId(id)), parent_kind: targetKind, parent_id: storedId(target), position: position + index }
        : { op: "move", kind, id: rowIdOfId(id), parent_kind: targetKind, parent: target, position: position + index });
      const answers = await runGesture("paste", steps);
      await load(false);
      return answers.flatMap(leftBehindOf);
    },
    [load, rowIdOfId],
  );

  const removeNode = useCallback(
    async (nodesToDelete: Array<{ id: string; kind: NodeKind }>): Promise<void> => {
      await awaitLane();
      // One gesture operation for the lot — a multi-selection, or the subtree the confirm dialog
      // expanded into its nodes — so it comes back in a single press, and against a server it is
      // one request. The Aspects are the board's fixed roots and are never deleted.
      const nodes = nodesToDelete
        .filter(({ kind }) => kind !== "aspect" && kind !== "habit_group")
        .map(({ id, kind }) => ({ kind, id: rowIdOfId(id) }));
      if (nodes.length > 0) {
        await withGesture(t("gestures.delete", { count: nodesToDelete.length }), () => deleteNodes(nodes));
      }
      await load(false);
    },
    [load, rowIdOfId, t],
  );

  /**
   * Writes a commitment configured in the new-commitment editor, under `parentId`.
   *
   * Separate from `createNode`'s commitment branch, which posts a bare title: a commitment is
   * invalid without a window, so the one Shift+C opens carries the window the user just set.
   * `is_private` and tags are not fields of the create request, so they follow it — before the
   * reload, so the new row appears once, configured, rather than twice, half-configured first.
   * Any refusal propagates to the editor, which keeps itself open and shows it.
   *
   * A Habit occurrence takes one like any other parent: the backend writes it under the Habit's
   * host, hangs it on the occurrence, and gives it the occurrence's window when it names none.
   */
  const createCommitmentNode = useCallback(
    async (parentId: string, parentKind: NodeKind, data: CommitmentSaveData): Promise<void> => {
      // Stays write-then-reload (ADR 0012): behind a create still in the lane, whose row it may hang on.
      await awaitLane();
      const commitmentId = await createCommitmentUnderNode(rowIdOfId(parentId), parentKind, data);
      for (const tagId of data.tagIds) await addTagToCommitment(commitmentId, tagId);
      await load(false);
    },
    [load, rowIdOfId],
  );

  const createFlowNode = useCallback(
    async (request: CreateFlowRequest): Promise<Flow> => {
      await awaitLane();
      const flow = await createFlow(request);
      await load(false);
      return flow;
    },
    [load],
  );

  const updateFlowNode = useCallback(
    async (id: number, request: UpdateFlowRequest): Promise<void> => {
      await updateFlow(id, request);
      await load(false);
    },
    [load],
  );

  // Refreshes the tree in place, WITHOUT the spinner — every caller is a post-mutation refresh
  // (status toggles, edits, deletes, conversions). `MindmapView` early-returns a full-screen
  // "Loading…" whenever `isLoading` is true, which unmounts the canvas and takes pan, zoom and
  // focus with it, so raising the spinner here makes every mutation flash the whole view.
  // Only the initial mount passes `true`.
  const reload = useCallback(() => load(false), [load]);

  // An edit in another window ends in exactly this reload. Two views of one board that silently
  // disagree are worse than one view, and the cheapest way to have none is to reuse the refresh
  // every local mutation already ends in. See `use-board-changed`.
  useBoardChanged(reload);

  return {
    tree,
    isLoading,
    error,
    loadCondition,
    createNode,
    settleCreated,
    createChild,
    renameNode,
    reorderNode,
    moveNode,
    duplicateNode,
    pasteNodes,
    insertParent,
    removeNode,
    createCommitment: createCommitmentNode,
    createFlow: createFlowNode,
    updateFlow: updateFlowNode,
    reload: reload,
  };
}
