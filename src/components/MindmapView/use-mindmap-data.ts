import { useCallback, useEffect, useRef, useState } from "react";
import { useDisplayStore } from "@/stores/use-display-store";
import { useTranslation } from "react-i18next";
import { createDomain, updateDomain, deleteDomain, duplicateDomain } from "@/api/domains";
import { createTask, updateTask, deleteTask, duplicateTask, TASK_ARCHIVAL } from "@/api/tasks";
import { createCommitment, updateCommitment, deleteCommitment, addTagToCommitment } from "@/api/commitments";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { Commitment } from "@/api/commitments";
import { createExpectation, updateExpectation, deleteExpectation } from "@/api/expectations";
import { EXPECTATION_STATUS, EXPECTATION_ARCHIVAL } from "@/api/expectation-status";
import type { Expectation, ExpectationCheck, SpawnedWaitView } from "@/api/expectations";
import {
  checkNodeId, checkTaskNodeId, delegationWaitNodeId, expectationNodeId, spawnedCheckNodeId,
  spawnedWaitNodeId,
} from "@/utils/node-uuid";
import type { Verdict } from "@/api/verdict";
import { VERDICT } from "@/api/verdict";
import type { TaskAgentic, TaskDependencyEdge } from "@/api/tasks";
import type { BlockReason } from "@/api/block-reasons";
import { createGoal, updateGoal, deleteGoal, duplicateGoal } from "@/api/goals";
import { createInfo, updateInfo, deleteInfo, duplicateInfo } from "@/api/infos";
import { getErrorMessage } from "@/api/errors";
import { asRetypeKind, retypeNode as backendRetype } from "@/api/retype";
import type { StrandedChildren } from "@/api/retype";
import { loadMindmap, habitIterations, habitStatuses } from "@/api/mindmap";
import { withGesture } from "@/api/gesture";
import { useBoardChanged } from "@/hooks/use-board-changed";
import type { MindmapLoad } from "@/api/mindmap";
import {
  createFlow, updateFlow, deleteFlow,
  createFlowGoal, createFlowTask, updateFlowGoal, updateFlowTask, deleteFlowItem, convertFlowItem,
  duplicateFlow, duplicateFlowItem,
} from "@/api/flows";
import { findNode } from "@/utils/mindmap-tree";
import { rowIdOf, rowIdOfNodeId } from "@/utils/node-identity";
import { TASK_STATUS, GOAL_STATUS } from "@/utils/status-mapping";
import { propagateAgentic } from "@/utils/agentic";
import { listMcpAccess } from "@/api/mcp-access";
import type { McpVisibility } from "@/api/mcp-access";
import { applyMcpVisibility } from "@/utils/mcp-visibility";
import { useMcpAccessStore } from "@/stores/use-mcp-access-store";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import type { Goal } from "@/api/goals";
import type { Info } from "@/api/infos";
import type {
  Flow, CreateFlowRequest, UpdateFlowRequest,
  FlowGoal, FlowTask, FlowItemCycle, FlowDependency, FlowItemType, HabitChildKind,
  HabitInstance, HabitInstanceChild, HabitIteration, HabitItemStatus, InstanceType, TargetRef,
} from "@/api/flows";
import { createHabitInstanceChild, NO_CYCLE } from "@/api/flows";
import type { ItemLifecycle, Timing } from "@/api/scope-lifecycle";
import type { MindmapNode, NodeKind, FlowCyclePair, FlowItemDep, WaitRef } from "@/utils/tree-layout";
import { entityNodeId, flowTargetNodeId } from "@/utils/tree-layout";
import { formatScopeCore } from "@/utils/scope-format";
import type { ScopeLabelFns } from "@/hooks/use-scope-labels";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import type { CanonicalKind } from "@/utils/scope-ref";
import type { ScopeKey } from "@/api/scopes";
import { scopeKeyText } from "@/utils/scope-key";
import type { DurationSpec, TimeScope } from "@/api/time-scope";
import { localNowIso } from "@/utils/local-now";


/**
 * The key a node's lifecycle is filed under. A wait's **open** check is keyed by its wait, since the
 * backend times "the wait's next check" rather than one check by its instant; every other node by
 * its own id. A done check has no lifecycle.
 */
function lifecycleKey(node: MindmapNode): string {
  const wait = node.expectationCheck;
  if (wait === undefined || node.status === TASK_STATUS.DONE) return node.id;
  return wait.kind === "stored" ? checkTaskNodeId(wait.expectationId) : spawnedCheckNodeId(wait.taskId);
}

/** Stamps each Task/Goal/Commitment node with its derived lifecycle (Timing, then Resolution or
 * Verdict, then effective Archival). */
export function applyLifecycles(node: MindmapNode, byId: Map<string, ItemLifecycle>): void {
  const entry = byId.get(lifecycleKey(node));
  if (entry !== undefined) {
    node.timing = entry.timing;
    if (entry.plan_timing !== undefined) node.planTiming = entry.plan_timing;
    if (entry.resolution !== undefined) node.resolution = entry.resolution;
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
 * Each lifecycle keyed by the node id it stamps. A wait sends two: `expectation` times its own
 * Time Scope, and `expectation_check` its next check, which is what its virtual check task reads.
 * A spawned wait sends `spawned_wait` and `spawned_check`, keyed by the Task that spawned it.
 */
export function lifecycleMap(lifecycles: ItemLifecycle[]): Map<string, ItemLifecycle> {
  return new Map(lifecycles.map((l): [string, ItemLifecycle] => {
    if (l.node_type === "expectation") return [expectationNodeId(l.node_id), l];
    if (l.node_type === "expectation_check") return [checkTaskNodeId(l.node_id), l];
    if (l.node_type === "spawned_wait") return [spawnedWaitNodeId(l.node_id), l];
    if (l.node_type === "spawned_check") return [spawnedCheckNodeId(l.node_id), l];
    return [`${l.node_type}-${l.node_id}`, l];
  }));
}

/**
 * Display status for a virtual Habit instance from its stored status (or none). A goal reads
 * `achieved`/`active`; a task passes its status through (`todo`/`in_progress`/`done`).
 */
function instanceStatus(isGoal: boolean, raw: string | undefined): string {
  if (isGoal) return raw === "done" ? "achieved" : "active";
  return raw ?? "todo";
}

/**
 * Narrows a node kind to one a Habit occurrence can hold — everything a Task can parent.
 *
 * `null` for a Flow, a flow item or a domain-table kind: an occurrence is a Task, a Goal or a
 * Commitment, and holds exactly what one of those holds.
 */
function asHabitChildKind(kind: NodeKind): HabitChildKind | null {
  return kind === "task" || kind === "goal" || kind === "commitment" || kind === "info"
    ? kind
    : null;
}

/** What a Habit's iteration root draws as, from the flow's Instance Type. */
function iterationRootKind(instanceType: InstanceType): NodeKind {
  if (instanceType === "goal") return "goal";
  if (instanceType === "commitment") return "commitment";
  return "task";
}

/**
 * The Verdict one iteration of a commitment Habit reads, from the Modification slot that holds
 * it (the same `status` column an ordinary instance stores a task status in).
 *
 * Anything that is not one of the two verdicts — including nothing at all, and including a stale
 * `done` left by a flow that used to materialize Tasks — reads as `unresolved`. `done` is not
 * `kept`, and translating one into the other would invent a judgement nobody made.
 */
function instanceVerdict(raw: string | undefined): Verdict {
  if (raw === VERDICT.KEPT) return VERDICT.KEPT;
  if (raw === VERDICT.BROKEN) return VERDICT.BROKEN;
  return VERDICT.UNRESOLVED;
}

/** The window/archival fields a virtual iteration carries; the rest of the node is built around it. */
type IterationLifecycle = Pick<MindmapNode, "timing" | "resolution" | "archived">;

/**
 * An iteration whose **Verdict Window** ran out with no verdict recorded: archived, because the
 * chance to say has gone, and with no Resolution at all, because nothing in the Commitment kind
 * ever concludes an outcome the user did not state.
 *
 * Shared by the iteration root and the supporting steps under it — a step under a rule nobody
 * judged in time was not "missed" either.
 */
const EXPIRED_LIFECYCLE: IterationLifecycle = { timing: "lapsed", archived: true };

/**
 * A Task/Goal iteration's — or one of its occurrences' — derived lifecycle, from where its window
 * sits: once the window has passed it is archived as a unit, and its Resolution says whether it was
 * completed or missed.
 *
 * "pending" reaches here only from an **occurrence**, whose Cycle Scope can open later than the
 * iteration around it; an iteration root is never pending, because the backend generates only
 * iterations whose own window has begun. A pending occurrence gets no Resolution and no Archival:
 * nothing has happened to it yet, and calling it Missed before its window opens would be the app
 * concluding an outcome from a clock that has not reached it.
 *
 * There is no expiry case, and cannot be: a Verdict Window belongs to the Commitment kind, so the
 * backend derives `expired` only for a commitment Habit.
 */
function workIterationLifecycle(timing: Timing, done: boolean): IterationLifecycle {
  if (timing === "pending") return { timing: "pending" };
  if (timing === "active") return { timing: "active" };
  return { timing: "lapsed", resolution: done ? "completed" : "missed", archived: true };
}

/**
 * A commitment iteration's derived lifecycle — deliberately not the Task/Goal mapping above.
 *
 * A Commitment has no Resolution: the Verdict stands in its place, and nothing derives it, least
 * of all the window closing. So a past iteration nobody judged is **not** Missed and does not
 * archive — the answer is still owed. Once a verdict is in and the window has passed, that
 * iteration is settled, and archives.
 *
 * What ends "still owed" is the **Verdict Window**, which the Habit carries on the flow row and
 * every one of its iterations resolves to. `expired` is the backend saying that window has run
 * out with the verdict still unresolved, and it is checked **first**: an expired iteration is not
 * `past` in the sense the other branches mean, because under the Accumulating + Overlapping
 * Consumption a commitment Habit is fixed to, an unanswered iteration classifies Active rather
 * than Lapsed right up until it expires.
 */
function commitmentIterationLifecycle(
  past: boolean,
  expired: boolean,
  verdict: Verdict,
): IterationLifecycle {
  if (expired) return EXPIRED_LIFECYCLE;
  if (!past) return { timing: "active" };
  if (verdict === VERDICT.UNRESOLVED) return { timing: "lapsed" };
  return { timing: "lapsed", archived: true };
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

/** One flow item as the iteration builder reads it, with the flow-item table it came from. */
interface TemplateItem {
  itemType: FlowItemType;
  item: FlowGoal | FlowTask;
}

/** An item's key in the template map and in the status overlay: `"flow_task-12"`. */
function itemKey(itemType: string, itemId: number): string {
  return `${itemType}-${itemId}`;
}

/** The in-flow parent key of a template item, or `null` when it hangs directly on the flow. */
function parentKey(item: FlowGoal | FlowTask): string | null {
  return item.parent_type === "flow_goal" || item.parent_type === "flow_task"
    ? itemKey(item.parent_type, item.parent_id)
    : null;
}

/**
 * The template's hierarchy: the items that hang directly on the flow (in template order), and each
 * item's children by parent key.
 *
 * An item whose named parent is not in this flow's template is treated as a root rather than
 * dropped — the same last resort the iteration root itself gets when its host is filtered out.
 */
function templateHierarchy(items: ReadonlyMap<string, TemplateItem>): {
  roots: TemplateItem[];
  childrenOf: Map<string, TemplateItem[]>;
} {
  const roots: TemplateItem[] = [];
  const childrenOf = new Map<string, TemplateItem[]>();
  for (const entry of items.values()) {
    const parent = parentKey(entry.item);
    if (parent === null || !items.has(parent)) {
      roots.push(entry);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [entry]);
    else siblings.push(entry);
  }
  return { roots, childrenOf };
}

/**
 * One occurrence of one template item, as a virtual node.
 *
 * The window is the backend's: `instance.time_scope` is the item's Cycle Scope resolved against
 * *this* iteration's window, and `instance.timing` is where that window stands under the Habit's
 * Consumption. Both are stamped like any other node's, which is what makes a Morning item read
 * Pending at dawn, Active in the morning and Lapsed in the afternoon instead of Active all day.
 */
function occurrenceNode(
  flow: Flow,
  iteration: HabitIteration,
  entry: TemplateItem,
  instance: HabitInstance,
  statuses: ReadonlyMap<string, string>,
  color: string | undefined,
  expired: boolean,
): MindmapNode {
  const { itemType, item } = entry;
  const scopeId = iteration.anchor_scope_id;
  const raw = statuses.get(`${itemKey(itemType, item.id)}-${instance.cycle_id}-${scopeKeyText(scopeId)}`);
  const done = raw === "done";
  return {
    id: `habititem-${itemType}-${item.id}-${instance.cycle_id}-${iteration.index}-virtual`,
    kind: itemType === "flow_goal" ? "goal" : "task",
    title: item.title,
    status: instanceStatus(itemType === "flow_goal", raw),
    virtual: true,
    habitItem: {
      flowId: flow.id, itemType, itemId: item.id, scopeId, cycleId: instance.cycle_id,
    },
    ...(color !== undefined ? { color } : {}),
    timeScope: instance.time_scope,
    plan: instance.plan,
    ...(expired ? EXPIRED_LIFECYCLE : workIterationLifecycle(instance.timing, done)),
    isPrivate: item.is_private,
    position: item.position,
    tagIds: [],
    children: [],
  };
}

/**
 * Builds one iteration's **virtual** instances under its root, mirroring the template's hierarchy.
 *
 * The iteration carries its own occurrence list, resolved backend-side: an item with N cycle pairs
 * appears N times — SPEC's "a flow item with N pairs produces N items", which starting the flow has
 * always obeyed — each with its own resolved window, including the ones whose windows have not
 * opened yet (those carry `timing` "pending"; the filter, not this builder, decides whether they
 * are drawn).
 *
 * Every template item therefore contributes at least one occurrence, and a subtree always has a
 * parent to hang under — children nest under their parent's first occurrence, as they do when the
 * flow is started. The `continue` below is a guard against an instance list that names no item at
 * all, not a window rule.
 *
 * Each occurrence is individually completable (`habitItem`), keyed by its cycle pair as well as its
 * item; its status comes from `statuses` (`"itemType-itemId-cycleId-scopeId"` → stored status).
 * Returns the occurrences parented on the flow — the iteration root's direct children.
 */
function buildIterationItems(
  flow: Flow,
  iteration: HabitIteration,
  items: ReadonlyMap<string, TemplateItem>,
  statuses: ReadonlyMap<string, string>,
  color: string | undefined,
  expired: boolean,
): MindmapNode[] {
  const occurrences = new Map<string, MindmapNode[]>();
  for (const instance of iteration.instances) {
    const key = itemKey(instance.item_type, instance.item_id);
    const entry = items.get(key);
    if (entry === undefined) continue;
    const node = occurrenceNode(flow, iteration, entry, instance, statuses, color, expired);
    const drawn = occurrences.get(key);
    if (drawn === undefined) occurrences.set(key, [node]);
    else drawn.push(node);
  }

  const { roots, childrenOf } = templateHierarchy(items);
  const attached: MindmapNode[] = [];
  const pending: Array<{ entry: TemplateItem; host: MindmapNode[] }> = roots.map((entry) => ({
    entry,
    host: attached,
  }));
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const next = pending[cursor];
    if (next === undefined) continue;
    const key = itemKey(next.entry.itemType, next.entry.item.id);
    const drawn = occurrences.get(key) ?? [];
    const [first] = drawn;
    // No occurrence at all — nothing in the iteration named this item, so there is nowhere for
    // its subtree to hang either. Not a window rule: an unopened window still draws an occurrence.
    if (first === undefined) continue;
    next.host.push(...drawn);
    for (const child of childrenOf.get(key) ?? []) {
      pending.push({ entry: child, host: first.children });
    }
  }
  return attached;
}

/**
 * Whether a flow's template holds items its own Instance Type cannot parent: goal items under a
 * flow that materializes a Commitment, which holds Tasks and other Commitments but no Goals.
 *
 * Starting such a flow is refused outright by the `goals.parent_type` constraint, so its
 * iterations are refused here on the same grounds rather than drawn as a subtree the model
 * forbids. The condition is reported to the user by {@link collectLoadConditions}; it is never a
 * quiet omission.
 */
export function holdsUnrenderableGoalItems(flow: Flow, flowGoals: readonly FlowGoal[]): boolean {
  return flow.instance_type === "commitment" && flowGoals.some((goal) => goal.flow_id === flow.id);
}

/**
 * An occurrence's key in the added-children map: `"flow_task-12-3-88"` — item, cycle pair and
 * iteration scope, the same quadruple the backend attaches by.
 */
function instanceKey(
  itemType: string, itemId: number, cycleId: number, iterationScopeId: ScopeKey,
): string {
  return `${itemType}-${itemId}-${cycleId}-${scopeKeyText(iterationScopeId)}`;
}

/** Every added child grouped by the occurrence it hangs on. */
function childrenByInstance(
  children: readonly HabitInstanceChild[],
): Map<string, HabitInstanceChild[]> {
  const byInstance = new Map<string, HabitInstanceChild[]>();
  for (const child of children) {
    const key = instanceKey(child.item_type, child.item_id, child.cycle_id, child.iteration_scope_id);
    const drawn = byInstance.get(key);
    if (drawn === undefined) byInstance.set(key, [child]);
    else drawn.push(child);
  }
  return byInstance;
}

/** Lifts a node out of the tree, returning it (with its own subtree) or `undefined`. */
function detachNode(root: MindmapNode, id: string): MindmapNode | undefined {
  const index = root.children.findIndex((child) => child.id === id);
  if (index >= 0) return root.children.splice(index, 1)[0];
  for (const child of root.children) {
    const found = detachNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Every occurrence node in one iteration — the root and each item instance beneath it. */
function occurrenceNodes(root: MindmapNode): MindmapNode[] {
  const found: MindmapNode[] = [];
  const visit = (node: MindmapNode): void => {
    if (node.habitItem !== undefined) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/**
 * Moves each occurrence's **added children** out of the ordinary tree and under the occurrence
 * they belong to.
 *
 * They are real rows, so `buildTree` has already placed them — under the occurrence's host, which
 * is where their `parent_type`/`parent_id` point, because a virtual instance has no id for those
 * columns to name. Moving the node rather than rebuilding one keeps everything already stamped on
 * it: its lifecycle, its tags, its block reasons, and its own children, which are ordinary nodes
 * parented to it in the ordinary way and need no attachment of their own.
 *
 * A child whose node is not in the tree is skipped, not invented: it may have been filtered out,
 * and an attachment naming a row that is gone is not a reason to draw something.
 */
function attachAddedChildren(
  tree: MindmapNode,
  iterationRoot: MindmapNode,
  byInstance: ReadonlyMap<string, HabitInstanceChild[]>,
): void {
  if (byInstance.size === 0) return;
  for (const occurrence of occurrenceNodes(iterationRoot)) {
    const item = occurrence.habitItem;
    if (item === undefined) continue;
    const attached = byInstance.get(
      instanceKey(item.itemType, item.itemId, item.cycleId, item.scopeId),
    );
    for (const child of attached ?? []) {
      const moved = detachNode(tree, entityNodeId(child.child_type, child.child_id));
      if (moved !== undefined) occurrence.children.push(moved);
    }
  }
}

/**
 * Injects each Habit's derived iterations as **virtual**, read-only child nodes under its Target
 * Node — its explicit one, or its parent when it has none (`flowTargetNodeId`). Each iteration root
 * carries the flow's items as its own virtual, per-item-completable instances. Every injected node is
 * `virtual` with no `rowId`, which keeps it out of DB-backed mutations (they carry no `rowId`, so
 * `rowIdOf` refuses them). `iterationsByFlow[i]` / `statusesByFlow[i]` correspond to `flows[i]` (empty for
 * non-habits).
 *
 * A flow whose template its Instance Type cannot hold contributes nothing — see
 * {@link holdsUnrenderableGoalItems}.
 */
export function injectHabitInstances(
  root: MindmapNode,
  flows: Flow[],
  iterationsByFlow: HabitIteration[][],
  labels: ScopeLabelFns,
  now: string,
  flowGoals: FlowGoal[] = [],
  flowTasks: FlowTask[] = [],
  statusesByFlow: HabitItemStatus[][] = [],
  addedChildren: HabitInstanceChild[] = [],
): void {
  const childrenOfFlow = childrenByInstance(addedChildren);
  flows.forEach((flow, i) => {
    const iterations = iterationsByFlow[i] ?? [];
    if (iterations.length === 0) return;
    if (holdsUnrenderableGoalItems(flow, flowGoals)) return;
    // The flow node itself is the last resort, not a meaning of null: a derived target whose parent
    // is filtered out of the rendered tree still has somewhere to hang its iterations.
    const host = findNode(root, flowTargetNodeId(flow)) ?? findNode(root, `flow-${flow.id}`);
    if (host === undefined) return;
    const templateItems: TemplateItem[] = [
      ...flowGoals.filter((g) => g.flow_id === flow.id).map((item) => ({ itemType: "flow_goal" as const, item })),
      ...flowTasks.filter((t) => t.flow_id === flow.id).map((item) => ({ itemType: "flow_task" as const, item })),
    ];
    const items = new Map(
      templateItems.map((entry) => [itemKey(entry.itemType, entry.item.id), entry]),
    );
    // Keyed by the cycle pair too: one item can draw several occurrences in a single iteration, and
    // completing the morning one must not tick the evening one off with it.
    const statuses = new Map(
      (statusesByFlow[i] ?? []).map((s) => [
        `${itemKey(s.item_type, s.item_id)}-${s.cycle_id}-${scopeKeyText(s.iteration_scope_id)}`,
        s.status,
      ]),
    );
    for (const iteration of iterations) {
      const scopeId = iteration.anchor_scope_id;
      const past = iteration.status === "lapsed" || iteration.status === "missed";
      // A commitment Habit's iteration whose Verdict Window ran out unanswered. It archives — the
      // chance to record a verdict has gone — but it is never given a Resolution, because nothing
      // in this kind ever concludes an outcome the user did not state.
      const expired = iteration.status === "expired";
      // What the Mindmap's collapse of passed iterations folds by. `window_end` is exclusive, and
      // the Habit's Consumption cannot answer this on its own: under Overlapping nothing lapses,
      // so a long-closed window is still `active`.
      const windowPassed = iteration.window_end <= now;
      // The root is its own instance (`flow_root`, keyed by the flow id) with its own status.
      const rootRaw = statuses.get(`${itemKey("flow_root", flow.id)}-${NO_CYCLE}-${scopeKeyText(scopeId)}`);
      const rootDone = rootRaw === "done";
      const isCommitment = flow.instance_type === "commitment";
      const rootVerdict = instanceVerdict(rootRaw);
      const iterationRoot: MindmapNode = {
        id: `habit-${flow.id}-${iteration.index}-virtual`,
        kind: iterationRootKind(flow.instance_type),
        title: `${flow.title} ${iterationAnchorLabel(flow, iteration, labels)}`,
        // A commitment iteration carries a Verdict where the other two carry a status: it is kept
        // or broken, never advanced, so there is no status for a control to cycle.
        ...(isCommitment
          ? { verdict: rootVerdict }
          : { status: instanceStatus(flow.instance_type === "goal", rootRaw) }),
        virtual: true,
        habitItem: {
          flowId: flow.id, itemType: "flow_root", itemId: flow.id, scopeId, cycleId: NO_CYCLE,
        },
        habitIteration: {
          flowId: flow.id,
          flowTitle: flow.title,
          index: iteration.index,
          scopeKind: toCanonicalKind(flow.flow_duration_kind),
          anchorDate: iteration.anchor_date,
          windowEnd: iteration.window_end,
          passed: windowPassed,
          // "Done" is the iteration finishing as it was meant to: completed for a work Habit,
          // Kept for a commitment one. A broken or unanswered verdict counts with the misses.
          done: isCommitment ? rootVerdict === VERDICT.KEPT : rootDone,
        },
        // Iterations are injected after buildTree's colour propagation, so inherit the host's
        // already-resolved aspect colour directly.
        ...(host.color !== undefined ? { color: host.color } : {}),
        ...(isCommitment
          ? commitmentIterationLifecycle(past, expired, rootVerdict)
          : workIterationLifecycle(past ? "lapsed" : "active", rootDone)),
        isPrivate: flow.is_private,
        position: iteration.index,
        tagIds: [],
        children: buildIterationItems(flow, iteration, items, statuses, host.color, expired),
      };
      host.children.push(iterationRoot);
      // After the iteration is assembled, because an added child hangs on an occurrence and the
      // occurrences are what has just been built.
      attachAddedChildren(root, iterationRoot, childrenOfFlow);
    }
  });
}

export const GOAL_CHILDREN_ACTION = {
  REMOVE: "remove",
  REPARENT: "reparent",
} as const;

export type GoalChildrenAction = "remove" | "reparent";

export interface RetypeOptions {
  /** Flow-goal children of a flow item being converted to a flow-task. */
  goalChildrenAction?: GoalChildrenAction;
  /**
   * Children the new kind cannot hold, for a retype `retype_node` owns — and, by being present
   * at all, the caller's acknowledgement of everything else the backend said would be lost.
   * Without it the command refuses rather than dropping anything quietly.
   */
  strandedChildren?: StrandedChildren;
  /**
   * A window for a node becoming a Commitment that has none of its own and nothing above it to
   * inherit one from. Supplied in answer to the backend's `needs_time_scope` refusal, and carried
   * on the retype itself so the conversion stays a single atomic write.
   */
  timeScope?: TimeScope;
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
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  retypeNode: (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions) => Promise<string | null>;
  reorderNode: (id: string, direction: 1 | -1) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number) => Promise<void>;
  duplicateNode: (id: string, kind: NodeKind, targetId: string, targetKind: NodeKind, position: number) => Promise<void>;
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
    case "flow_goal": case "flow_task": throw new Error("Flow items cannot parent info nodes");
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
    case "flow": case "flow_goal": case "flow_task": case "habit_group":
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
    case "flow": case "flow_goal": case "flow_task": return kind;
    // `habit_group` is among them because a folded run of passed iterations is drawn, not stored
    // — it is nobody's parent.
    case "aspect": case "domain": case "project": case "goal":
    case "task": case "commitment": case "expectation": case "tag": case "info": case "habit_group":
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
function contentParentKey(parentType: string, parentId: number): string {
  if (parentType === "goal") return `goal-${parentId}`;
  if (parentType === "task") return `task-${parentId}`;
  if (parentType === "commitment") return `commitment-${parentId}`;
  return `domain-${parentId}`;
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

/**
 * A wait's virtual "check on it" task, due on `due`. It has no row. A completed one (`dueAt`
 * given) stays as a done task, carrying the instant it fell due so it can be reopened.
 *
 * Its `id` names the check by the instant it fell due ({@link checkNodeId}), open or done alike, so
 * completing it keeps the node: the selection stays on it and the focus exemption holds it on screen
 * under the presets that hide done work.
 */
function checkTaskNode(
  id: string, title: string, due: TimeScope, wait: WaitRef, isPrivate: boolean, doneDueAt?: string,
): MindmapNode {
  return {
    id,
    kind: "task",
    title,
    status: doneDueAt === undefined ? TASK_STATUS.TODO : TASK_STATUS.DONE,
    ...(doneDueAt !== undefined ? { checkDueAt: doneDueAt } : {}),
    timeScope: due,
    onScopeExit: "keep",
    virtual: true,
    expectationCheck: wait,
    position: Number.MIN_SAFE_INTEGER,
    isPrivate,
    tagIds: [],
    children: [],
  };
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
  /** The title a delegated Task's virtual Expectation is drawn with, from the Task's own. */
  delegationWaitTitle: (taskTitle: string) => string = (taskTitle) => taskTitle,
  expectationChecks: ExpectationCheck[] = [],
  spawnedWaits: SpawnedWaitView[] = [],
  /** The title a wait's check task is drawn with, from the wait's own: the settings' prefix. */
  checkTitle: (waitTitle: string) => string = (waitTitle) => waitTitle,
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
      rowId: domain.id,
      kind: subtypeToKind(domain.subtype),
      title: domain.title,
      position: domain.position,
      isPrivate: domain.is_private,
      ...(domain.color !== null ? { color: domain.color } : {}),
      ...(domain.status !== null ? { status: domain.status } : {}),
      ...(domain.knowledge_base_directory !== null ? { knowledgeBaseDirectory: domain.knowledge_base_directory } : {}),
      ...(domain.beads_id !== undefined ? { beadsId: domain.beads_id } : {}),
      tagIds: [],
      children: [],
    });
  }

  for (const goal of goals) {
    nodeMap.set(`goal-${goal.id}`, {
      id: `goal-${goal.id}`,
      rowId: goal.id,
      kind: "goal",
      title: goal.title,
      status: goal.status,
      blockReasons: manualBlockers.get(`goal-${goal.id}`) ?? [],
      timeScope: goal.time_scope,
      onScopeExit: goal.on_scope_exit,
      position: goal.position,
      isPrivate: goal.is_private,
      ...(goal.beads_id !== undefined ? { beadsId: goal.beads_id } : {}),
      tagIds: goal.tag_ids,
      children: [],
    });
  }

  for (const task of tasks) {
    nodeMap.set(`task-${task.id}`, {
      id: `task-${task.id}`,
      rowId: task.id,
      kind: "task",
      title: task.title,
      status: task.status,
      blockReasons: manualBlockers.get(`task-${task.id}`) ?? [],
      virtualBlockers: [],
      timeScope: task.time_scope,
      onScopeExit: task.on_scope_exit,
      plan: task.plan,
      backlogged: task.archival === TASK_ARCHIVAL.BACKLOG,
      agentic: task.agentic,
      delegate: task.delegate_to,
      asynchronous: task.asynchronous,
      asyncTemplate: task.async_template ?? null,
      agenticBrief: task.agentic_brief ?? null,
      position: task.position,
      isPrivate: task.is_private,
      ...(task.beads_id !== undefined ? { beadsId: task.beads_id } : {}),
      tagIds: task.tag_ids,
      children: [],
    });
  }

  for (const commitment of commitments) {
    nodeMap.set(`commitment-${commitment.id}`, {
      id: `commitment-${commitment.id}`,
      rowId: commitment.id,
      kind: "commitment",
      title: commitment.title,
      verdict: commitment.verdict,
      verdictWindow: commitment.verdict_window ?? null,
      timeScope: commitment.time_scope,
      position: commitment.position,
      isPrivate: commitment.is_private,
      ...(commitment.beads_id !== undefined ? { beadsId: commitment.beads_id } : {}),
      tagIds: commitment.tag_ids,
      children: [],
    });
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const checkDue = new Map(expectationChecks.flatMap((check) =>
    check.resolved_at === undefined ? [[check.expectation_id, check] as const] : []));
  for (const expectation of expectations) {
    const id = expectationNodeId(expectation.id);
    const node: MindmapNode = {
      id,
      rowId: expectation.id,
      kind: "expectation",
      title: expectation.title,
      status: expectation.status,
      archived: expectation.archival === EXPECTATION_ARCHIVAL.ARCHIVED,
      checkEvery: expectation.check_every ?? null,
      checkStarting: expectation.check_starting ?? null,
      timeScope: expectation.time_scope,
      position: expectation.position,
      isPrivate: expectation.is_private,
      ...(expectation.agentic === true
        ? { agentWaiting: { note: expectation.agentic_note ?? null } }
        : {}),
      tagIds: expectation.tag_ids,
      children: [],
    };
    // While a check is due, a virtual "check on it" Task hangs beneath the wait, drawn on the day
    // it is due. Nothing stores it; completing it records the check and nothing else.
    const due = checkDue.get(expectation.id);
    const ref: WaitRef = { kind: "stored", expectationId: expectation.id };
    // Every completed check stays as a done check task; the presets that hide done work hide it.
    for (const done of expectationChecks) {
      if (done.expectation_id !== expectation.id || done.resolved_at === undefined) continue;
      node.children.push(checkTaskNode(
        checkNodeId(ref, done.due_at), checkTitle(expectation.title), done.due, ref,
        expectation.is_private, done.due_at,
      ));
    }
    if (due !== undefined) {
      node.children.push(checkTaskNode(
        checkNodeId(ref, due.due_at), checkTitle(expectation.title), due.due, ref, expectation.is_private,
      ));
    }
    nodeMap.set(id, node);
  }

  // The wait an Asynchronous Task spawned while it is done: virtual, drawn from the Task's template
  // and its overlay, and hung beneath the Task. The backend sends one only while it exists; a
  // Task here without a template has nothing to draw it from.
  const templateOf = new Map(tasks.flatMap((task) =>
    task.asynchronous && task.async_template !== undefined ? [[task.id, task.async_template] as const] : []));
  for (const spawned of spawnedWaits) {
    const template = templateOf.get(spawned.task_id);
    if (template === undefined) continue;
    const wait: MindmapNode = {
      id: spawnedWaitNodeId(spawned.task_id),
      kind: "expectation",
      title: template.title,
      status: spawned.status,
      archived: spawned.archival === EXPECTATION_ARCHIVAL.ARCHIVED,
      checkEvery: template.check_every ?? null,
      timeScope: spawned.time_scope ?? null,
      virtual: true,
      spawnedBy: { taskId: spawned.task_id },
      position: Number.MIN_SAFE_INTEGER,
      isPrivate: taskById.get(spawned.task_id)?.is_private ?? false,
      tagIds: template.tag_ids,
      children: [],
    };
    const spawnedRef: WaitRef = { kind: "spawned", taskId: spawned.task_id };
    for (const done of spawned.done_checks) {
      wait.children.push(checkTaskNode(
        checkNodeId(spawnedRef, done.due_at), checkTitle(template.title), done.due, spawnedRef,
        wait.isPrivate ?? false, done.due_at,
      ));
    }
    if (spawned.next_check !== undefined) {
      wait.children.push(checkTaskNode(
        spawned.next_check_at !== undefined
          ? checkNodeId(spawnedRef, spawned.next_check_at)
          : spawnedCheckNodeId(spawned.task_id),
        checkTitle(template.title), spawned.next_check, spawnedRef, wait.isPrivate ?? false,
      ));
    }
    nodeMap.get(`task-${spawned.task_id}`)?.children.push(wait);
  }

  // A delegated Task waits on its delegate finishing: a virtual, pending Expectation beneath it
  // for as long as it is not done. It has no row and no Check every, and only the Task being done
  // releases it — which is simply the moment it stops being drawn.
  for (const task of tasks) {
    if (task.delegate_to === null || task.status === TASK_STATUS.DONE) continue;
    nodeMap.get(`task-${task.id}`)?.children.push({
      id: delegationWaitNodeId(task.id),
      kind: "expectation",
      title: delegationWaitTitle(task.title),
      status: EXPECTATION_STATUS.PENDING,
      checkEvery: null,
      virtual: true,
      delegationWait: { taskId: task.id },
      position: Number.MIN_SAFE_INTEGER,
      isPrivate: task.is_private,
      tagIds: [],
      children: [],
    });
  }

  // Virtual block reasons: a task is also blocked by any dependency on a non-done task, a
  // non-achieved goal or a pending expectation. Derived here from the bulk dependency edges so the
  // canvas shows it without per-task calls.
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const expectationById = new Map(expectations.map((e) => [e.id, e]));
  for (const dep of taskDeps) {
    const node = nodeMap.get(`task-${dep.task_id}`);
    if (node === undefined) continue;
    if (dep.dependency_type === "expectation") {
      node.expectationDependencyIds = [...(node.expectationDependencyIds ?? []), dep.dependency_id];
      const target = expectationById.get(dep.dependency_id);
      if (target !== undefined && target.status === EXPECTATION_STATUS.PENDING) {
        node.virtualBlockers?.push(`Blocked by expectation ${dep.dependency_id} (${target.title})`);
      }
    } else if (dep.dependency_type === "task") {
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
      rowId: item.id,
      kind: itemType,
      title: item.title,
      position: item.position,
      isPrivate: item.is_private,
      flowItem: {
        itemType,
        flowId: item.flow_id,
        flowInstanceType: owningFlow?.instance_type ?? "task",
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
  // Agentic inherits downward and is overridable, exactly as a delegate does, so the value a node
  // reads is resolved here once rather than by an ancestor walk at every badge and filter.
  propagateAgentic(root, false);
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

/** One virtual Habit occurrence, as the node carrying it names itself. */
type Occurrence = NonNullable<MindmapNode["habitItem"]>;

/**
 * Writes one node onto a virtual Habit occurrence, attaches it there in the same backend call,
 * and hands back the kind and row id it was given.
 *
 * The reload is deliberately *not* here. A caller with more to say about the new node — a
 * Commitment's verdict, window, privacy and tags — has to say it before the board is rebuilt, or
 * the node appears twice: half-configured first and configured second.
 */
async function attachOccurrenceChild(
  occurrence: Occurrence,
  childKind: NodeKind,
  title: string,
): Promise<{ kind: HabitChildKind; id: number }> {
  const kind = asHabitChildKind(childKind);
  if (kind === null) {
    throw new Error(`A habit occurrence cannot hold a node of kind "${childKind}"`);
  }
  const child = await createHabitInstanceChild(
    occurrence.flowId, occurrence.itemType, occurrence.itemId, occurrence.scopeId,
    occurrence.cycleId, kind, title,
  );
  return { kind, id: child.node_id };
}

/**
 * The window fields an editor-configured commitment carries, omitted when it named none.
 *
 * Absent is not the same as `null` here: absent inherits the window above, which for an occurrence
 * child is the occurrence's own — the one the attachment already wrote.
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
 * Writes a commitment configured in the editor onto a virtual Habit occurrence, and answers with
 * its row id.
 *
 * The attachment writes the row already carrying the occurrence's window — a commitment is never
 * momentarily windowless — and the editor's own fields follow it. That second write is where the
 * ordinary path's single create refuses, so a refusal here takes the row back out again: the
 * editor stays open on the field that earned it, and the Save the user tries next makes one
 * commitment rather than a second one beside an abandoned first.
 */
async function attachCommitmentToOccurrence(
  occurrence: Occurrence,
  data: CommitmentSaveData,
): Promise<number> {
  const { id } = await attachOccurrenceChild(occurrence, "commitment", data.title);
  try {
    await updateCommitment(id, {
      verdict: data.verdict,
      ...commitmentWindow(data),
      ...(data.isPrivate ? { is_private: true } : {}),
    });
  } catch (error: unknown) {
    await deleteCommitment(id);
    throw error;
  }
  return id;
}

/** Writes a commitment configured in the editor under an ordinary, row-backed parent. */
async function createCommitmentUnderNode(
  parentRowId: number,
  parentKind: NodeKind,
  data: CommitmentSaveData,
): Promise<number> {
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

/**
 * Which stored nodes the MCP can see. A failure here costs the badges, not the board: it is logged
 * and the board loads without them, since nothing else on screen depends on the answer.
 */
async function loadMcpVisibility(): Promise<McpVisibility[]> {
  try {
    return await listMcpAccess();
  } catch (error: unknown) {
    console.warn("[arlesh] could not read which nodes the MCP can see:", error);
    return [];
  }
}

export function useMindmapData(): MindmapData {
  const { t } = useTranslation(["undo", "expectation"]);
  const [tree, setTree] = useState<MindmapNode>(VIRTUAL_ROOT);
  // Read through a ref, set in an effect, so `load` does not change identity with `t` — which
  // would re-run the mount effect and reload for nothing. Declared before that effect, so the
  // first load already has it.
  const delegationWaitTitle = useRef((title: string) => title);
  useEffect(() => {
    delegationWaitTitle.current = (title: string) => t("expectation:delegationWaitTitle", { title });
  }, [t]);
  // A check task is titled `{prefix}{wait title}`, the prefix a display setting. Unlike the
  // translation above it is a dependency of `load`: changing it redraws the board with the new
  // titles rather than leaving them stale until the next edit.
  const storedCheckPrefix = useDisplayStore((s) => s.checkTaskPrefix);
  const checkPrefix = storedCheckPrefix ?? t("expectation:checkTaskPrefixDefault");
  // The tree as of the latest load, read synchronously by the mutations to resolve a node id to
  // its row. A ref rather than the `tree` closure: a caller that creates a node and acts on it in
  // the same gesture holds a callback from before the reload that drew it.
  const latestTree = useRef<MindmapNode>(VIRTUAL_ROOT);
  const rowIdOfId = useCallback((nodeId: string): number => rowIdOfNodeId(latestTree.current, nodeId), []);
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
        const [data, mcpVisible] = await Promise.all([loadMindmap(now), loadMcpVisibility()]);
        const built = buildTree(
          data.domains, data.goals, data.tasks, data.infos, data.commitments, data.flows,
          data.flow_goals, data.flow_tasks, data.flow_cycles, data.flow_dependencies,
          data.block_reasons, data.task_dependencies, data.flow_instance_nodes,
          data.expectations, (title) => delegationWaitTitle.current(title),
          data.expectation_checks, data.spawned_waits, (title) => `${checkPrefix}${title}`,
        );
        applyLifecycles(built, lifecycleMap(data.lifecycles));
        // Inject each Habit's iterations as virtual, read-only child nodes under their targets.
        // A flow whose derivation failed contributes an empty list here and a load condition
        // below — it is not silently indistinguishable from a flow that simply has no iterations.
        injectHabitInstances(
          built, data.flows, habitIterations(data.habits), scopeLabels, now,
          data.flow_goals, data.flow_tasks, habitStatuses(data.habits),
          data.habit_instance_children,
        );
        // Last, so the Habit occurrences just injected take their hosts' answer too.
        applyMcpVisibility(built, mcpVisible);
        latestTree.current = built;
        setTree(built);
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

  /**
   * Creates one node under a virtual Habit occurrence and attaches it there, in one backend call.
   *
   * The child belongs to that occurrence alone — next week's is not carrying it — and is a real,
   * fully editable node in every other respect. The four kinds are the ones a Task can parent; a
   * Flow or a flow item is refused, as it is under a Task.
   */
  const createOccurrenceChild = useCallback(
    async (
      occurrence: Occurrence,
      childKind: NodeKind,
      title: string,
    ): Promise<MindmapNode> => {
      const { kind, id } = await attachOccurrenceChild(occurrence, childKind, title);
      const newNode: MindmapNode = {
        id: entityNodeId(kind, id),
        rowId: id,
        kind, title,
        ...(kind === "task" ? { status: TASK_STATUS.TODO } : {}),
        ...(kind === "goal" ? { status: GOAL_STATUS.ACTIVE } : {}),
        ...(kind === "commitment" ? { verdict: VERDICT.UNRESOLVED } : {}),
        position: 0, tagIds: [], children: [],
      };
      await load(false);
      return newNode;
    },
    [load],
  );

  const createNode = useCallback(
    async (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string, agentic?: TaskAgentic): Promise<MindmapNode> => {
      // A virtual Habit occurrence has no row id, so it takes its children through the attachment
      // path rather than through `rowIdOf`. Everything below is unchanged for every other
      // parent: the same gesture, the same kinds, a real node either way.
      const occurrence = findNodeInTree(tree, parentId)?.habitItem;
      if (occurrence !== undefined) {
        return createOccurrenceChild(occurrence, childKind, title);
      }

      const dbParentId = rowIdOfId(parentId);

      if (childKind === "domain" || childKind === "project" || childKind === "tag") {
        const domain = await createDomain({
          title, description: null, subtype: childKind,
          parent_id: dbParentId, status: null, knowledge_base_directory: null,
        });
        const newNode: MindmapNode = {
          id: `domain-${domain.id}`, rowId: domain.id, kind: childKind, title: domain.title,
          position: domain.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "goal") {
        const goal = await createGoal({ title, parent_type: kindToParentType(parentKind), parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `goal-${goal.id}`, rowId: goal.id, kind: "goal", title: goal.title,
          status: goal.status, position: goal.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "task") {
        // Spread rather than passed as `agentic: agentic`: under `exactOptionalPropertyTypes` an
        // explicit `undefined` is not the same as an absent field, and absent is what "no opinion,
        // take the default" has to send.
        const task = await createTask({
          title, parent_type: kindToParentType(parentKind), parent_id: dbParentId,
          ...(agentic !== undefined ? { agentic } : {}),
        });
        const newNode: MindmapNode = {
          id: `task-${task.id}`, rowId: task.id, kind: "task", title: task.title,
          status: task.status, position: task.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "commitment") {
        // No Time Scope is sent: a fresh commitment inherits the window above it, and the
        // backend refuses it outright when there is none — a rule that can never come due is
        // not something to create and fix up later.
        const commitment = await createCommitment({
          title, parent_type: kindToParentType(parentKind), parent_id: dbParentId,
        });
        const newNode: MindmapNode = {
          id: `commitment-${commitment.id}`, rowId: commitment.id, kind: "commitment", title: commitment.title,
          verdict: commitment.verdict, position: commitment.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      if (childKind === "expectation") {
        const expectation = await createExpectation({
          title, parent_type: kindToParentType(parentKind), parent_id: dbParentId,
        });
        const newNode: MindmapNode = {
          id: expectationNodeId(expectation.id), rowId: expectation.id, kind: "expectation",
          title: expectation.title, status: expectation.status, checkEvery: expectation.check_every ?? null,
          position: expectation.position, tagIds: [], children: [],
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
          id: `info-${info.id}`, rowId: info.id, kind: "info", title: info.body,
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
          rowId: item.id,
          kind: childKind, title: item.title,
          position: item.position, tagIds: [], children: [],
        };
        await load(false);
        return newNode;
      }

      throw new Error(`Cannot create a node of kind "${childKind}"`);
    },
    [load, rowIdOfId, tree, createOccurrenceChild],
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
        // A commitment's default child is another commitment: the common shape is a month
        // holding each day's instance, not a month holding a chore.
        : parentKind === "commitment" ? "commitment"
        : parentKind === "flow" ? flowRootChildKind()
        : parentKind === "flow_goal" ? "flow_goal"
        : parentKind === "flow_task" ? "flow_task"
        // A Tag holds notes about itself and nothing else (Arlesh-71m taught `isValidDropTarget`
        // that and left this table behind), so its default child is the only child it can take.
        : parentKind === "tag" ? "info"
        : "domain"; // aspect, domain → domain
      return createNode(parentId, parentKind, childKind, title);
    },
    [createNode, tree],
  );

  const renameNode = useCallback(
    async (id: string, kind: NodeKind, title: string): Promise<void> => {
      const dbId = rowIdOfId(id);
      if (kind === "goal") {
        await updateGoal(dbId, { title });
      } else if (kind === "task") {
        await updateTask(dbId, { title });
      } else if (kind === "commitment") {
        await updateCommitment(dbId, { title });
      } else if (kind === "expectation") {
        await updateExpectation(dbId, { title });
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
    [load, rowIdOfId],
  );

  const retypeNode = useCallback(
    async (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions): Promise<string | null> => {
      const dbId = rowIdOfId(id);
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
          const parentDbId = rowIdOf(parent);
          for (const child of node.children.filter((c) => c.kind === "flow_goal")) {
            const childDbId = rowIdOf(child);
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

      // Every retype between the goals, tasks, domains and infos tables is one atomic backend
      // call. `retype_node` creates the new row with every field that carries, moves the tags and
      // the block reasons, repoints the dependency edges aimed at the node, adopts the children the
      // new kind can hold and settles the ones it cannot — or does none of it. It also refuses
      // outright, with a payload naming what is at stake, rather than dropping anything quietly;
      // `use-node-type-manager` is what puts that to the user and retries with the answer.
      //
      // Infos used to be orchestrated here instead, as a chain of separate calls: that dropped
      // `details` and `is_private` unannounced, left a duplicate node behind when the final delete
      // failed, and — because an info's parent link is polymorphic — could write a `parent_type`
      // naming a table its `parent_id` did not point into.
      const sourceKind = asRetypeKind(fromKind);
      const targetKind = asRetypeKind(toKind);
      if (sourceKind !== null && targetKind !== null) {
        const retyped = await backendRetype(
          sourceKind, dbId, targetKind, options?.strandedChildren, options?.timeScope,
        );
        await load(false);
        return entityNodeId(retyped.kind, retyped.id);
      }

      return null;
    },
    [load, rowIdOfId, tree],
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
      const nodeDbId = rowIdOf(node);
      const neighborDbId = rowIdOf(neighbor);
      const nodePos = node.position;
      const neighborPos = neighbor.position;

      // Swap positions, dispatching to the correct table for each node.
      const setPos = async (nId: number, kind: NodeKind, pos: number): Promise<void> => {
        if (kind === "goal") await updateGoal(nId, { position: pos });
        else if (kind === "task") await updateTask(nId, { position: pos });
        else if (kind === "commitment") await updateCommitment(nId, { position: pos });
        else if (kind === "expectation") await updateExpectation(nId, { position: pos });
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
          await updateInfo(dbId, { parent_type: kindToInfoParentType(newParentKind), parent_id: dbParentId, position });
          break;
        case "flow": {
          const request: UpdateFlowRequest = {
            parent_type: kindToFlowParentType(newParentKind),
            parent_id: dbParentId,
            position,
          };
          // The Target Node is not touched. A flow with no explicit target resolves to its parent
          // on read, so the instances follow the move by construction; a target pointed elsewhere
          // was chosen deliberately and stays where it was put.
          await updateFlow(dbId, request);
          break;
        }
        case "flow_goal":
        case "flow_task": {
          // Flow items move only within their flow subtree; parent is the flow or another item.
          const parentType = newParentKind === "flow" ? "flow" : newParentKind;
          const update = kind === "flow_goal" ? updateFlowGoal : updateFlowTask;
          await update(dbId, { parent_type: parentType, parent_id: dbParentId, position });
          break;
        }
        case "domain":
        case "project":
        case "tag":
          await updateDomain(dbId, { parent_id: dbParentId, position });
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
   */
  const duplicateNode = useCallback(
    async (id: string, kind: NodeKind, targetId: string, targetKind: NodeKind, position: number): Promise<void> => {
      const dbId = rowIdOfId(id);
      const dbTargetId = rowIdOfId(targetId);
      // Exhaustive over NodeKind, for the same reason `moveNode` is: node ids are polymorphic, so a
      // kind with no branch of its own must be a compile error rather than a fall-through that
      // hands the id to whichever table the default happens to name.
      switch (kind) {
        case "goal":
          await duplicateGoal(dbId, kindToParentType(targetKind), dbTargetId, position);
          break;
        case "task":
          await duplicateTask(dbId, kindToParentType(targetKind), dbTargetId, position);
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
          await duplicateInfo(dbId, kindToInfoParentType(targetKind), dbTargetId, position);
          break;
        case "project":
        case "domain":
        case "tag":
          await duplicateDomain(dbId, dbTargetId, position);
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
    },
    [load, rowIdOfId],
  );

  const removeNode = useCallback(
    async (nodesToDelete: Array<{ id: string; kind: NodeKind }>): Promise<void> => {
      // One delete per node, so one Gesture around the lot: a multi-selection, or the subtree the
      // confirm dialog expanded into its nodes, has to come back in a single press.
      await withGesture(t("gestures.delete", { count: nodesToDelete.length }), async () => {
        for (const { id, kind } of nodesToDelete) {
          const dbId = rowIdOfId(id);
          if (kind === "goal") await deleteGoal(dbId);
          else if (kind === "task") await deleteTask(dbId);
          else if (kind === "commitment") await deleteCommitment(dbId);
          else if (kind === "expectation") await deleteExpectation(dbId);
          else if (kind === "info") await deleteInfo(dbId);
          else if (kind === "flow") await deleteFlow(dbId);
          else if (kind === "flow_goal") await deleteFlowItem("flow_goal", dbId);
          else if (kind === "flow_task") await deleteFlowItem("flow_task", dbId);
          else if (kind !== "aspect") await deleteDomain(dbId);
        }
      });
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
   * A **virtual Habit occurrence** has no row id for a parent link, so it takes its commitment
   * through the attachment path instead, exactly as every other kind does in `createNode`. The
   * attachment writes the row already carrying the occurrence's own window — a commitment is never
   * momentarily windowless — and returns it, so the editor's fields are written onto it by the
   * same follow-up writes the ordinary path uses, and still before the reload.
   */
  const createCommitmentNode = useCallback(
    async (parentId: string, parentKind: NodeKind, data: CommitmentSaveData): Promise<void> => {
      const occurrence = findNodeInTree(tree, parentId)?.habitItem;
      const commitmentId =
        occurrence !== undefined
          ? await attachCommitmentToOccurrence(occurrence, data)
          : await createCommitmentUnderNode(rowIdOfId(parentId), parentKind, data);
      for (const tagId of data.tagIds) await addTagToCommitment(commitmentId, tagId);
      await load(false);
    },
    [load, rowIdOfId, tree],
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
    createChild,
    renameNode,
    retypeNode,
    reorderNode,
    moveNode,
    duplicateNode,
    removeNode,
    createCommitment: createCommitmentNode,
    createFlow: createFlowNode,
    updateFlow: updateFlowNode,
    reload: reload,
  };
}
