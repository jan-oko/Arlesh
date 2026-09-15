import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { createDomain, updateDomain, deleteDomain } from "@/api/domains";
import { createTask, updateTask, deleteTask } from "@/api/tasks";
import type { TaskDependencyEdge } from "@/api/tasks";
import type { BlockReason } from "@/api/block-reasons";
import { createGoal, updateGoal, deleteGoal } from "@/api/goals";
import { createInfo, updateInfo, deleteInfo } from "@/api/infos";
import { getErrorMessage } from "@/api/errors";
import { asRetypeKind, retypeNode as backendRetype } from "@/api/retype";
import type { StrandedChildren } from "@/api/retype";
import { loadMindmap, habitIterations, habitStatuses } from "@/api/mindmap";
import type { MindmapLoad } from "@/api/mindmap";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import {
  createFlow, updateFlow, deleteFlow,
  createFlowGoal, createFlowTask, updateFlowGoal, updateFlowTask, deleteFlowItem, convertFlowItem,
} from "@/api/flows";
import { findNode } from "@/utils/mindmap-tree";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import type { Goal } from "@/api/goals";
import type { Info } from "@/api/infos";
import type {
  Flow, CreateFlowRequest, UpdateFlowRequest,
  FlowGoal, FlowTask, FlowItemCycle, FlowDependency, FlowItemType, HabitIteration, HabitItemStatus, TargetRef,
} from "@/api/flows";
import type { ItemLifecycle } from "@/api/scope-lifecycle";
import type { MindmapNode, NodeKind, FlowCyclePair, FlowItemDep } from "@/utils/tree-layout";
import { entityNodeId } from "@/utils/tree-layout";
import { formatScopeCore } from "@/utils/scope-format";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import type { CanonicalKind } from "@/utils/scope-ref";

/** Local wall-clock now as a `YYYY-MM-DDTHH:MM:SS` string for the scope-lifecycle derivation. */
function localNowIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** Stamps each Task/Goal node with its derived lifecycle (Timing/Resolution/effective Archival). */
function applyLifecycles(node: MindmapNode, byId: Map<string, ItemLifecycle>): void {
  const entry = byId.get(node.id);
  if (entry !== undefined) {
    node.timing = entry.timing;
    if (entry.resolution !== undefined) node.resolution = entry.resolution;
    node.archived = entry.archival === "archived";
    node.archivalConflict = entry.archival_conflict;
  }
  for (const child of node.children) applyLifecycles(child, byId);
}

function lifecycleMap(lifecycles: ItemLifecycle[]): Map<string, ItemLifecycle> {
  return new Map(lifecycles.map((l) => [`${l.node_type}-${l.node_id}`, l]));
}

/**
 * Display status for a virtual Habit instance from its stored status (or none). A goal reads
 * `achieved`/`active`; a task passes its status through (`todo`/`in_progress`/`done`).
 */
function instanceStatus(isGoal: boolean, raw: string | undefined): string {
  if (isGoal) return raw === "done" ? "achieved" : "active";
  return raw ?? "todo";
}

function toCanonicalKind(kind: string | null): CanonicalKind | null {
  return kind === "day" || kind === "week" || kind === "month" || kind === "season" ? kind : null;
}

/**
 * A habit iteration's anchor, formatted as a scope of the flow's Duration kind (e.g. "W28", per
 * SPEC's `{flow title} {start scope}`) rather than the raw ISO date — falls back to the raw date
 * for a sub-day (Phase) window, which has no canonical scope label.
 */
function iterationAnchorLabel(flow: Flow, iteration: HabitIteration, labels: ScopeLabelFns): string {
  const kind = toCanonicalKind(flow.flow_duration_kind);
  return kind === null ? iteration.anchor_date : formatScopeCore(kind, iteration.anchor_date, labels);
}

/**
 * Builds the flow's template items as **virtual**, per-iteration instances under one iteration root,
 * mirroring the template's parent hierarchy. Each item is individually completable (`habitItem`); its
 * status comes from `statuses` (`"itemType-itemId-scopeId"` → stored status). Returns the items
 * parented on the flow (the iteration root's direct children); nested items attach under their parent.
 */
function buildIterationItems(
  flow: Flow,
  scopeId: number,
  index: number,
  items: Array<{ itemType: FlowItemType; item: FlowGoal | FlowTask }>,
  statuses: ReadonlyMap<string, string>,
  color: string | undefined,
  past: boolean,
): MindmapNode[] {
  const nodeByItem = new Map<string, MindmapNode>();
  for (const { itemType, item } of items) {
    const raw = statuses.get(`${itemType}-${item.id}-${scopeId}`);
    const done = raw === "done";
    nodeByItem.set(`${itemType}-${item.id}`, {
      id: `habititem-${itemType}-${item.id}-${index}-virtual`,
      kind: itemType === "flow_goal" ? "goal" : "task",
      title: item.title,
      status: instanceStatus(itemType === "flow_goal", raw),
      virtual: true,
      habitItem: { flowId: flow.id, itemType, itemId: item.id, scopeId },
      ...(color !== undefined ? { color } : {}),
      ...(past
        ? { timing: "lapsed" as const, resolution: done ? "completed" as const : "missed" as const, archived: true }
        : { timing: "active" as const }),
      isPrivate: item.is_private,
      position: item.position,
      tagIds: [],
      children: [],
    });
  }
  const roots: MindmapNode[] = [];
  for (const { itemType, item } of items) {
    const node = nodeByItem.get(`${itemType}-${item.id}`);
    if (node === undefined) continue;
    const parent =
      item.parent_type === "flow_goal" || item.parent_type === "flow_task"
        ? nodeByItem.get(`${item.parent_type}-${item.parent_id}`)
        : undefined;
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Injects each Habit's derived iterations as **virtual**, read-only child nodes under its target
 * (or the flow node when it has no target). Each iteration root carries the flow's items as its own
 * virtual, per-item-completable instances. The `-virtual` id suffix keeps every injected node out of
 * DB-backed mutations (`dbIdFromNodeId` rejects a non-numeric tail). `iterationsByFlow[i]` /
 * `statusesByFlow[i]` correspond to `flows[i]` (empty for non-habits).
 */
export function injectHabitInstances(
  root: MindmapNode,
  flows: Flow[],
  iterationsByFlow: HabitIteration[][],
  labels: ScopeLabelFns,
  flowGoals: FlowGoal[] = [],
  flowTasks: FlowTask[] = [],
  statusesByFlow: HabitItemStatus[][] = [],
): void {
  flows.forEach((flow, i) => {
    const iterations = iterationsByFlow[i] ?? [];
    if (iterations.length === 0) return;
    const hostId =
      flow.target_type !== null && flow.target_id !== null
        ? entityNodeId(flow.target_type, flow.target_id)
        : `flow-${flow.id}`;
    const host = findNode(root, hostId);
    if (host === undefined) return;
    const items: Array<{ itemType: FlowItemType; item: FlowGoal | FlowTask }> = [
      ...flowGoals.filter((g) => g.flow_id === flow.id).map((item) => ({ itemType: "flow_goal" as const, item })),
      ...flowTasks.filter((t) => t.flow_id === flow.id).map((item) => ({ itemType: "flow_task" as const, item })),
    ];
    const statuses = new Map(
      (statusesByFlow[i] ?? []).map((s) => [`${s.item_type}-${s.item_id}-${s.iteration_scope_id}`, s.status]),
    );
    for (const iteration of iterations) {
      const scopeId = iteration.anchor_scope_id;
      const past = iteration.status === "lapsed" || iteration.status === "missed";
      // The root is its own instance (`flow_root`, keyed by the flow id) with its own status.
      const rootRaw = statuses.get(`flow_root-${flow.id}-${scopeId}`);
      const rootDone = rootRaw === "done";
      host.children.push({
        id: `habit-${flow.id}-${iteration.index}-virtual`,
        kind: flow.instance_type === "goal" ? "goal" : "task",
        title: `${flow.title} ${iterationAnchorLabel(flow, iteration, labels)}`,
        status: instanceStatus(flow.instance_type === "goal", rootRaw),
        virtual: true,
        habitItem: { flowId: flow.id, itemType: "flow_root", itemId: flow.id, scopeId },
        // Iterations are injected after buildTree's colour propagation, so inherit the host's
        // already-resolved aspect colour directly.
        ...(host.color !== undefined ? { color: host.color } : {}),
        ...(past
          ? { timing: "lapsed" as const, resolution: rootDone ? "completed" as const : "missed" as const, archived: true }
          : { timing: "active" as const }),
        isPrivate: flow.is_private,
        position: iteration.index,
        tagIds: [],
        children: buildIterationItems(flow, scopeId, iteration.index, items, statuses, host.color, past),
      });
    }
  });
}

export const GOAL_CHILDREN_ACTION = {
  REMOVE: "remove",
  REPARENT: "reparent",
} as const;

export const INFO_CHILDREN_ACTION = {
  REMOVE: "remove",
  REPARENT: "reparent",
} as const;

export type GoalChildrenAction = "remove" | "reparent";
export type InfoChildrenAction = "remove" | "reparent";

export interface RetypeOptions {
  /** Flow-goal children of a flow item being converted to a flow-task. */
  goalChildrenAction?: GoalChildrenAction;
  /** Non-info children of a node being converted to an info. */
  infoChildrenAction?: InfoChildrenAction;
  /**
   * Children the new kind cannot hold, for a retype `retype_node` owns — and, by being present
   * at all, the caller's acknowledgement of everything else the backend said would be lost.
   * Without it the command refuses rather than dropping anything quietly.
   */
  strandedChildren?: StrandedChildren;
}

interface MindmapData {
  tree: MindmapNode;
  isLoading: boolean;
  error: string | null;
  createNode: (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string) => Promise<MindmapNode>;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  retypeNode: (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions) => Promise<string | null>;
  reorderNode: (id: string, direction: 1 | -1) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number) => Promise<void>;
  removeNode: (nodesToDelete: Array<{ id: string; kind: NodeKind }>) => Promise<void>;
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

function dbIdFromNodeId(nodeId: string): number {
  const parts = nodeId.split("-");
  const id = parseInt(parts[parts.length - 1] ?? "", 10);
  if (Number.isNaN(id)) throw new Error(`Node "${nodeId}" is not backed by a database row`);
  return id;
}

function kindToParentType(kind: NodeKind): string {
  if (kind === "goal") return "goal";
  if (kind === "task") return "task";
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
    case "flow": throw new Error("Flow nodes cannot parent info nodes");
    case "flow_goal": case "flow_task": throw new Error("Flow items cannot parent info nodes");
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
  if (info.parent_type === "info") return `info-${info.parent_id}`;
  return `domain-${info.parent_id}`;
}

/** Node id for a flow item — `flowgoal-<id>` / `flowtask-<id>` (distinct from real goals/tasks). */
function flowItemNodeId(itemType: FlowItemType, id: number): string {
  return itemType === "flow_goal" ? `flowgoal-${id}` : `flowtask-${id}`;
}

/** Node id of a flow item's in-flow parent (the flow itself, or another item). */
function flowItemParentKey(flowId: number, parentType: string, parentId: number): string {
  if (parentType === "flow_goal") return `flowgoal-${parentId}`;
  if (parentType === "flow_task") return `flowtask-${parentId}`;
  return `flow-${flowId}`;
}

function toCyclePair(cycle: FlowItemCycle): FlowCyclePair {
  return {
    scopeKind: cycle.scope_kind, scopeIndex: cycle.scope_index,
    planKind: cycle.plan_kind, planStart: cycle.plan_start, planEnd: cycle.plan_end,
  };
}

export function buildTree(
  domains: Domain[],
  goals: Goal[],
  tasks: Task[],
  infos: Info[],
  flows: Flow[] = [],
  flowGoals: FlowGoal[] = [],
  flowTasks: FlowTask[] = [],
  flowCycles: FlowItemCycle[] = [],
  flowDeps: FlowDependency[] = [],
  blockReasons: BlockReason[] = [],
  taskDeps: TaskDependencyEdge[] = [],
  flowInstanceRefs: TargetRef[] = [],
): MindmapNode {
  const nodeMap = new Map<string, MindmapNode>();

  // Explicit block reasons, grouped per owner in stored (position) order.
  const manualBlockers = new Map<string, string[]>();
  for (const br of blockReasons) {
    const key = `${br.owner_type}-${br.owner_id}`;
    const list = manualBlockers.get(key);
    if (list === undefined) manualBlockers.set(key, [br.reason]);
    else list.push(br.reason);
  }

  for (const domain of domains) {
    nodeMap.set(`domain-${domain.id}`, {
      id: `domain-${domain.id}`,
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
      kind: "goal",
      title: goal.title,
      status: goal.status,
      blockReasons: manualBlockers.get(`goal-${goal.id}`) ?? [],
      timeScope: goal.time_scope,
      onScopeExit: goal.on_scope_exit,
      position: goal.position,
      isPrivate: goal.is_private,
      tagIds: goal.tag_ids,
      children: [],
    });
  }

  for (const task of tasks) {
    nodeMap.set(`task-${task.id}`, {
      id: `task-${task.id}`,
      kind: "task",
      title: task.title,
      status: task.status,
      blockReasons: manualBlockers.get(`task-${task.id}`) ?? [],
      virtualBlockers: [],
      timeScope: task.time_scope,
      onScopeExit: task.on_scope_exit,
      plan: task.plan,
      position: task.position,
      isPrivate: task.is_private,
      tagIds: task.tag_ids,
      children: [],
    });
  }

  // Virtual block reasons: a task is also blocked by any dependency on a non-done task / non-achieved
  // goal. Derived here from the bulk dependency edges so the canvas shows it without per-task calls.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  for (const dep of taskDeps) {
    const node = nodeMap.get(`task-${dep.task_id}`);
    if (node === undefined) continue;
    if (dep.dependency_type === "task") {
      const target = taskById.get(dep.dependency_id);
      if (target !== undefined && target.status !== "done") {
        node.virtualBlockers?.push(`Blocked by task ${dep.dependency_id} (${target.title})`);
      }
    } else {
      const target = goalById.get(dep.dependency_id);
      if (target !== undefined && target.status !== "achieved") {
        node.virtualBlockers?.push(`Blocked by goal ${dep.dependency_id} (${target.title})`);
      }
    }
  }

  for (const info of infos) {
    nodeMap.set(`info-${info.id}`, {
      id: `info-${info.id}`,
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
    item: FlowGoal | FlowTask,
  ): void => {
    const id = flowItemNodeId(itemType, item.id);
    const owningFlow = flowById.get(item.flow_id);
    nodeMap.set(id, {
      id,
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
      },
      tagIds: [],
      children: [],
    });
  };
  for (const goal of flowGoals) buildFlowItem("flow_goal", goal);
  for (const task of flowTasks) buildFlowItem("flow_task", task);

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
    const parentKey =
      task.parent_type === "task"
        ? `task-${task.parent_id}`
        : task.parent_type === "goal"
          ? `goal-${task.parent_id}`
          : `domain-${task.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(taskNode);
    }
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

/** The tree node a flow's iterations hang under — the toast's anchor when they are missing. */
function habitHostId(flow: Flow): string {
  return flow.target_type !== null && flow.target_id !== null
    ? entityNodeId(flow.target_type, flow.target_id)
    : `flow-${flow.id}`;
}

/**
 * Tells the user which flows lost their Habit iterations to a backend failure.
 *
 * These used to be swallowed by a per-call `.catch(() => [])`, which made a failed derivation
 * indistinguishable from a flow that genuinely has none. The envelope now carries the reason per
 * flow, and the notice is anchored on the node the missing iterations would have hung under.
 * Only one toast fits, so the first failure is named and the rest are counted.
 */
function reportHabitFailures(
  data: MindmapLoad,
  showToast: (toast: { nodeId: string; message: string }) => void,
  t: TFunction<"warnings">,
): void {
  const failed = data.habits.filter((entry) => entry.result.outcome === "failed");
  const first = failed[0];
  if (first === undefined) return;
  const flow = data.flows.find((candidate) => candidate.id === first.flow_id);
  showToast({
    nodeId: flow === undefined ? `flow-${first.flow_id}` : habitHostId(flow),
    message:
      failed.length === 1
        ? t("habitLoadFailed", { title: first.flow_title })
        : t("habitLoadFailedMore", { title: first.flow_title, count: failed.length - 1 }),
  });
}

export function useMindmapData(): MindmapData {
  const [tree, setTree] = useState<MindmapNode>(VIRTUAL_ROOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scopeLabels = useScopeLabels();
  const showToast = useMindmapStore((state) => state.showToast);
  const { t } = useTranslation("warnings");

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
        const data = await loadMindmap(localNowIso());
        const built = buildTree(
          data.domains, data.goals, data.tasks, data.infos, data.flows, data.flow_goals,
          data.flow_tasks, data.flow_cycles, data.flow_dependencies, data.block_reasons,
          data.task_dependencies, data.flow_instance_nodes,
        );
        applyLifecycles(built, lifecycleMap(data.lifecycles));
        // Inject each Habit's iterations as virtual, read-only child nodes under their targets.
        // A flow whose derivation failed contributes an empty list here and a notice below —
        // it is not silently indistinguishable from a flow that simply has no iterations.
        injectHabitInstances(
          built, data.flows, habitIterations(data.habits), scopeLabels,
          data.flow_goals, data.flow_tasks, habitStatuses(data.habits),
        );
        setTree(built);
        reportHabitFailures(data, showToast, t);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (showSpinner) setIsLoading(false);
      }
    },
    [scopeLabels, showToast, t],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  const createNode = useCallback(
    async (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string): Promise<MindmapNode> => {
      const dbParentId = dbIdFromNodeId(parentId);

      if (childKind === "domain" || childKind === "project" || childKind === "tag") {
        const domain = await createDomain({
          title, description: null, subtype: childKind,
          parent_id: dbParentId, status: null, knowledge_base_directory: null,
        });
        const newNode: MindmapNode = {
          id: `domain-${domain.id}`, kind: childKind, title: domain.title,
          position: domain.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "goal") {
        const goal = await createGoal({ title, parent_type: kindToParentType(parentKind), parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `goal-${goal.id}`, kind: "goal", title: goal.title,
          status: goal.status, position: goal.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "task") {
        const task = await createTask({ title, parent_type: kindToParentType(parentKind), parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `task-${task.id}`, kind: "task", title: task.title,
          status: task.status, position: task.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "info") {
        const siblings = findNodeInTree(tree, parentId)?.children ?? [];
        const maxPos = siblings.reduce((m, c) => Math.max(m, c.position), -1);
        const info = await createInfo({
          body: title, parent_type: kindToInfoParentType(parentKind),
          parent_id: dbParentId, position: maxPos + 1,
        });
        const newNode: MindmapNode = {
          id: `info-${info.id}`, kind: "info", title: info.body,
          position: info.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "flow_goal" || childKind === "flow_task") {
        // A flow item's owning flow is the parent flow node, or the parent item's flow.
        const parent = findNodeInTree(tree, parentId);
        const flowId = parent?.kind === "flow" ? dbParentId : parent?.flowItem?.flowId;
        if (flowId === undefined) throw new Error(`Cannot create a flow item under "${parentId}"`);
        const parentType = parentKind === "flow" ? "flow" : parentKind;
        const request = { flow_id: flowId, title, parent_type: parentType, parent_id: dbParentId };
        const item = childKind === "flow_goal" ? await createFlowGoal(request) : await createFlowTask(request);
        const newNode: MindmapNode = {
          id: childKind === "flow_goal" ? `flowgoal-${item.id}` : `flowtask-${item.id}`,
          kind: childKind, title: item.title,
          position: item.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      throw new Error(`Cannot create a node of kind "${childKind}"`);
    },
    [load, tree],
  );

  const createChild = useCallback(
    async (parentId: string, parentKind: NodeKind, title: string): Promise<MindmapNode> => {
      // A flow root spawns items of its Instance Type; a flow item spawns items of its own kind.
      const flowRootChildKind = (): NodeKind =>
        findNodeInTree(tree, parentId)?.flow?.instanceType === "goal" ? "flow_goal" : "flow_task";
      const childKind: NodeKind =
        parentKind === "info" ? "info"
        : parentKind === "project" ? "project"
        : parentKind === "goal" ? "goal"
        : parentKind === "task" ? "task"
        : parentKind === "flow" ? flowRootChildKind()
        : parentKind === "flow_goal" ? "flow_goal"
        : parentKind === "flow_task" ? "flow_task"
        : "domain"; // aspect, domain → domain
      return createNode(parentId, parentKind, childKind, title);
    },
    [createNode, tree],
  );

  const renameNode = useCallback(
    async (id: string, kind: NodeKind, title: string): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      if (kind === "goal") {
        await updateGoal(dbId, { title });
      } else if (kind === "task") {
        await updateTask(dbId, { title });
      } else if (kind === "info") {
        await updateInfo(dbId, { body: title });
      } else if (kind === "flow_goal") {
        await updateFlowGoal(dbId, { title });
      } else if (kind === "flow_task") {
        await updateFlowTask(dbId, { title });
      } else if (kind === "flow") {
        await updateFlow(dbId, { title });
      } else {
        await import("@/api/domains").then(({ updateDomain }) => updateDomain(dbId, { title }));
      }
      await load(false);
    },
    [load],
  );

  const retypeNode = useCallback(
    async (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions): Promise<string | null> => {
      const dbId = dbIdFromNodeId(id);
      // The flow node itself is not part of the retype cycle (Phase 7.2 decision).
      if (fromKind === "flow") return null;

      // Flow items convert goal↔task in their own tables, preserving cycles and dependencies.
      if (fromKind === "flow_goal" || fromKind === "flow_task") {
        if ((toKind !== "flow_goal" && toKind !== "flow_task") || fromKind === toKind) return null;
        const node = findNodeInTree(tree, id);
        const parent = findParentInTree(tree, id);
        if (node === undefined || parent === undefined) return null;

        // A flow-goal child can't live under a flow-task; move it up or delete it per the prompt.
        if (fromKind === "flow_goal" && toKind === "flow_task") {
          const parentType = parent.kind === "flow" ? "flow" : parent.kind;
          const parentDbId = dbIdFromNodeId(parent.id);
          for (const child of node.children.filter((c) => c.kind === "flow_goal")) {
            const childDbId = dbIdFromNodeId(child.id);
            if (options?.goalChildrenAction === "reparent") {
              await updateFlowGoal(childDbId, { parent_type: parentType, parent_id: parentDbId });
            } else {
              await deleteFlowItem("flow_goal", childDbId);
            }
          }
        }

        const newId = await convertFlowItem(fromKind, dbId, toKind);
        await load(false);
        return toKind === "flow_goal" ? `flowgoal-${newId}` : `flowtask-${newId}`;
      }

      const domainTableKinds = new Set<NodeKind>(["domain", "project", "tag"]);

      // Everything between the goals, tasks and domains tables is one atomic backend call.
      // `retype_node` creates the new row with every field that carries, moves the tags and the
      // block reasons, repoints the dependency edges aimed at the node, adopts the children the
      // new kind can hold and settles the ones it cannot — or does none of it. It also refuses
      // outright, with a payload naming what is at stake, rather than dropping anything quietly;
      // `use-node-type-manager` is what puts that to the user and retries with the answer.
      const sourceKind = asRetypeKind(fromKind);
      const targetKind = asRetypeKind(toKind);
      if (sourceKind !== null && targetKind !== null) {
        const retyped = await backendRetype(sourceKind, dbId, targetKind, options?.strandedChildren);
        await load(false);
        return entityNodeId(retyped.kind, retyped.id);
      }

      // Info nodes still convert here: `retype_node` covers the goals, tasks and domains tables
      // only, and an info's parent link is polymorphic across all of them plus itself.
      const node = findNodeInTree(tree, id);
      const parent = findParentInTree(tree, id);
      const title = node?.title ?? "";
      const children = node?.children ?? [];
      const oldPosition = node?.position;
      const parentDbId = parent !== undefined && parent.id !== "root"
        ? dbIdFromNodeId(parent.id)
        : null;

      // To info: create info entry, re-parent info children, handle non-info children.
      if (toKind === "info") {
        if (parentDbId === null) return null;
        const parentInfoType = kindToInfoParentType(parent!.kind);
        const newInfo = await createInfo({
          body: title, parent_type: parentInfoType, parent_id: parentDbId,
          position: oldPosition ?? 0,
        });
        for (const child of children) {
          const childDbId = dbIdFromNodeId(child.id);
          if (child.kind === "info") {
            await updateInfo(childDbId, { parent_type: "info", parent_id: newInfo.id });
          } else {
            if (options?.infoChildrenAction === "reparent") {
              if (child.kind === "goal") {
                await updateGoal(childDbId, { parent_type: kindToParentType(parent!.kind), parent_id: parentDbId });
              } else if (child.kind === "task") {
                await updateTask(childDbId, { parent_type: kindToParentType(parent!.kind), parent_id: parentDbId });
              } else {
                await updateDomain(childDbId, { parent_id: parentDbId });
              }
            } else {
              if (child.kind === "goal") await deleteGoal(childDbId);
              else if (child.kind === "task") await deleteTask(childDbId);
              else if (child.kind !== "aspect") await deleteDomain(childDbId);
            }
          }
        }
        if (fromKind === "goal") await deleteGoal(dbId);
        else if (fromKind === "task") await deleteTask(dbId);
        else if (fromKind !== "aspect") await deleteDomain(dbId);
        await load(false);
        return `info-${newInfo.id}`;
      }

      // From info: create new entity, re-parent info children, delete info entry.
      if (fromKind === "info") {
        if (parentDbId === null) return null;
        if (toKind === "goal" || toKind === "task") {
          const parentType = kindToParentType(parent!.kind);
          if (toKind === "goal") {
            const newGoal = await createGoal({ title, parent_type: parentType, parent_id: parentDbId });
            if (oldPosition !== undefined) await updateGoal(newGoal.id, { position: oldPosition });
            for (const child of children) {
              if (child.kind === "info") {
                await updateInfo(dbIdFromNodeId(child.id), { parent_type: "goal", parent_id: newGoal.id });
              }
            }
            await deleteInfo(dbId);
            await load(false);
            return `goal-${newGoal.id}`;
          } else {
            const newTask = await createTask({ title, parent_type: parentType, parent_id: parentDbId });
            if (oldPosition !== undefined) await updateTask(newTask.id, { position: oldPosition });
            for (const child of children) {
              if (child.kind === "info") {
                await updateInfo(dbIdFromNodeId(child.id), { parent_type: "task", parent_id: newTask.id });
              }
            }
            await deleteInfo(dbId);
            await load(false);
            return `task-${newTask.id}`;
          }
        }
        if (domainTableKinds.has(toKind)) {
          const newDomain = await createDomain({
            title, subtype: toKind, parent_id: parentDbId,
            description: null, status: null, knowledge_base_directory: null,
          });
          if (oldPosition !== undefined) await updateDomain(newDomain.id, { position: oldPosition });
          for (const child of children) {
            if (child.kind === "info") {
              await updateInfo(dbIdFromNodeId(child.id), { parent_type: toKind, parent_id: newDomain.id });
            }
          }
          await deleteInfo(dbId);
          await load(false);
          return `domain-${newDomain.id}`;
        }
      }

      return null;
    },
    [load, tree],
  );

  const reorderNode = useCallback(
    async (id: string, direction: 1 | -1): Promise<void> => {
      const parent = findParentInTree(tree, id);
      if (parent === undefined) return;

      const siblings = parent.children;
      const idx = siblings.findIndex((s) => s.id === id);
      if (idx === -1) return;

      const neighborIdx = idx + direction;
      if (neighborIdx < 0 || neighborIdx >= siblings.length) return;

      const node = siblings[idx]!;
      const neighbor = siblings[neighborIdx]!;
      const nodeDbId = dbIdFromNodeId(id);
      const neighborDbId = dbIdFromNodeId(neighbor.id);
      const nodePos = node.position;
      const neighborPos = neighbor.position;

      // Swap positions, dispatching to the correct table for each node.
      const setPos = async (nId: number, kind: NodeKind, pos: number): Promise<void> => {
        if (kind === "goal") await updateGoal(nId, { position: pos });
        else if (kind === "task") await updateTask(nId, { position: pos });
        else if (kind === "info") await updateInfo(nId, { position: pos });
        else if (kind === "flow_goal") await updateFlowGoal(nId, { position: pos });
        else if (kind === "flow_task") await updateFlowTask(nId, { position: pos });
        else if (kind === "flow") await updateFlow(nId, { position: pos });
        else await updateDomain(nId, { position: pos });
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
      const dbId = dbIdFromNodeId(id);
      const dbParentId = dbIdFromNodeId(newParentId);
      if (kind === "goal") {
        await updateGoal(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
      } else if (kind === "task") {
        await updateTask(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
      } else if (kind === "info") {
        await updateInfo(dbId, { parent_type: kindToInfoParentType(newParentKind), parent_id: dbParentId, position });
      } else if (kind === "flow_goal" || kind === "flow_task") {
        // Flow items move only within their flow subtree; parent is the flow or another item.
        const parentType = newParentKind === "flow" ? "flow" : newParentKind;
        const update = kind === "flow_goal" ? updateFlowGoal : updateFlowTask;
        await update(dbId, { parent_type: parentType, parent_id: dbParentId, position });
      } else {
        await import("@/api/domains").then(({ updateDomain }) =>
          updateDomain(dbId, { parent_id: dbParentId, position }),
        );
      }
      await load(false);
    },
    [load],
  );

  const removeNode = useCallback(
    async (nodesToDelete: Array<{ id: string; kind: NodeKind }>): Promise<void> => {
      for (const { id, kind } of nodesToDelete) {
        const dbId = dbIdFromNodeId(id);
        if (kind === "goal") await deleteGoal(dbId);
        else if (kind === "task") await deleteTask(dbId);
        else if (kind === "info") await deleteInfo(dbId);
        else if (kind === "flow") await deleteFlow(dbId);
        else if (kind === "flow_goal") await deleteFlowItem("flow_goal", dbId);
        else if (kind === "flow_task") await deleteFlowItem("flow_task", dbId);
        else if (kind !== "aspect") await deleteDomain(dbId);
      }
      await load(false);
    },
    [load],
  );

  const createFlowNode = useCallback(
    async (request: CreateFlowRequest): Promise<Flow> => {
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

  // `reload` is the public, spinner-showing entry point; the flag stays inside the hook.
  const reload = useCallback(() => load(true), [load]);

  return {
    tree,
    isLoading,
    error,
    createNode,
    createChild,
    renameNode,
    retypeNode,
    reorderNode,
    moveNode,
    removeNode,
    createFlow: createFlowNode,
    updateFlow: updateFlowNode,
    reload: reload,
  };
}
