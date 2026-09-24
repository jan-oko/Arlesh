import { hierarchy, tree } from "d3-hierarchy";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { ScopeKey } from "@/api/scopes";
import type { TimeScope } from "@/api/time-scope";
import type { InstanceType, FlowItemType, HabitInstanceType } from "@/api/flows";
import type { OnScopeExit, Timing, Resolution } from "@/api/scope-lifecycle";
import type { Verdict } from "@/api/verdict";
import type { Delegate } from "@/api/tasks";
import type { DurationSpec } from "@/api/time-scope";
import type { AgenticBrief, AsyncTemplate } from "@/api/tasks";
import type { CanonicalKind } from "@/utils/scope-ref";
import { expectationNodeId } from "@/utils/node-uuid";

export type NodeKind =
  | "aspect" | "project" | "domain" | "goal" | "task" | "commitment" | "expectation" | "tag" | "info"
  | "flow" | "flow_goal" | "flow_task"
  /** A display-only stand-in for a run of passed Habit iterations — see {@link HabitGroup}. */
  | "habit_group";

/**
 * Every node kind, in the order anything that reads them all should read them out. It is the one
 * list: the `NodeKind` type guard narrows against it, and a message that names several kinds
 * orders them by it, so the same set always reads the same way.
 */
export const ALL_NODE_KINDS: readonly NodeKind[] = [
  "aspect", "project", "domain", "goal", "task", "commitment", "expectation", "tag", "info",
  "flow", "flow_goal", "flow_task", "habit_group",
];

/** Type guard: whether a string is a `NodeKind`. */
export function isNodeKind(value: string): value is NodeKind {
  return ALL_NODE_KINDS.some((kind) => kind === value);
}

/** Which wait a check task checks on: a stored Expectation, or the wait a Task's completion spawned. */
export type WaitRef = { kind: "stored"; expectationId: number } | { kind: "spawned"; taskId: number };

/** A task/goal is blocked when it has any block reason — explicit or virtual (from an unmet dependency). */
export function isNodeBlocked(node: MindmapNode): boolean {
  if (node.kind !== "task" && node.kind !== "goal") return false;
  return (node.blockReasons?.length ?? 0) + (node.virtualBlockers?.length ?? 0) > 0;
}

/** The four subtypes stored in the single `domains` table — all keyed `domain-<id>` in the tree. */
const DOMAIN_TABLE_KINDS: ReadonlySet<string> = new Set(["aspect", "project", "domain", "tag"]);

/**
 * The tree node id for an entity referenced by its `(type, id)` (e.g. a flow's stored target or
 * parent). Domain-table subtypes (aspect/project/domain/tag) share the single `domain-<id>`
 * namespace; goal/task keep their own. Never build `` `${type}-${id}` `` directly — a `project`
 * target would resolve to `project-<id>`, which no tree node uses, and silently miss.
 */
export function entityNodeId(type: string, id: number): string {
  // A kind added after the composed spellings were frozen mints its id instead.
  if (type === "expectation") return expectationNodeId(id);
  return DOMAIN_TABLE_KINDS.has(type) ? `domain-${id}` : `${type}-${id}`;
}

/** The `(type, id)` reference a flow stores for its parent and (optionally) its Target Node. */
export interface FlowPlacement {
  parent_type: string;
  parent_id: number;
  target_type: string | null;
  target_id: number | null;
}

/**
 * The tree node id a flow's instances belong under: its **Target Node** when it has an explicit
 * one, and otherwise its own parent — a null target means "my parent", derived here rather than
 * snapshotted into the row at creation, so moving the flow moves its instances with it.
 */
export function flowTargetNodeId(flow: FlowPlacement): string {
  return flow.target_type !== null && flow.target_id !== null
    ? entityNodeId(flow.target_type, flow.target_id)
    : entityNodeId(flow.parent_type, flow.parent_id);
}

/** Flow-template data carried by a `flow`-kind node. */
export interface FlowData {
  instanceType: InstanceType;
  targetType: string | null;
  targetId: number | null;
  durationN: number | null;
  durationKind: string | null;
  /** Phase-`part` band (e.g. "evening"), when durationKind is "part". */
  windowPart: string | null;
  /** Phase-`exact` time-of-day range "HH:MM", when durationKind is "exact". */
  windowTimeStart: string | null;
  windowTimeEnd: string | null;
  /** Whether this flow is a Habit (has a Recurrence) — drives the cyclical-arrows icon. */
  isHabit: boolean;
  /** Relative Cycle Plan for the root (task instance type only); all set together or all null. */
  rootPlanKind: string | null;
  rootPlanStart: number | null;
  rootPlanEnd: number | null;
  /** The **Verdict Window** a commitment Habit's iterations are bounded by, as the same `(n, kind)`
   * Duration a Commitment carries. Both null means its iterations never stop being answerable. */
  verdictWindowN: number | null;
  verdictWindowKind: string | null;
}

/** A relative (Cycle Scope, Cycle Plan) pair on a flow item. */
export interface FlowCyclePair {
  scopeKind: string | null;
  scopeIndex: number | null;
  planKind: string | null;
  planStart: number | null;
  planEnd: number | null;
}

/** A resolved intra-flow dependency edge (this item waits on `{type,id}`). */
export interface FlowItemDep {
  type: FlowItemType;
  id: number;
}

/** Template data carried by a `flow_goal`/`flow_task` node. */
export interface FlowItemData {
  itemType: FlowItemType;
  flowId: number;
  /** The owning flow's Instance Type, denormalised onto the item the way its Duration already is:
   * a flow item is retyped from the item's own node, which has no way back to the flow otherwise,
   * and what a commitment flow may hold is decided from it. */
  flowInstanceType: InstanceType;
  flowScopeN: number | null;
  flowScopeKind: string | null;
  cycles: FlowCyclePair[];
  dependsOn: FlowItemDep[];
}

/**
 * What one virtual Habit iteration contributes to a collapsed run: where its window sits, whether
 * that window has passed, and how it ended.
 *
 * Kept apart from `habitItem` (which names the Modification row a status click writes) because this
 * is purely what the renderer folds by — nothing here is ever written back.
 */
export interface HabitIterationMeta {
  /** The Habit this iteration belongs to; iterations fold only with their own flow's. */
  flowId: number;
  /** That Habit's own title — "Journal", not the iteration's "Journal 2026-09-14". A folded run
   * names the Habit it stands for, and this is the only place the renderer can read it: the run
   * node is built from the iterations alone, and the Flow node may be filtered out of the tree. */
  flowTitle: string;
  /** Zero-based ordinal from the Repetition Start, for ordering within a run. */
  index: number;
  /** The scope kind the iteration's window is one unit of, or `null` for a sub-day Phase window. */
  scopeKind: CanonicalKind | null;
  /** The window's first day, ISO `YYYY-MM-DD`. */
  anchorDate: string;
  /** The window's exclusive end, ISO `YYYY-MM-DDTHH:MM:SS`, as the backend derived it. */
  windowEnd: string;
  /** Whether that window had already closed at the load's reference instant. Only passed
   * iterations fold; the one whose window is still open always renders on its own. */
  passed: boolean;
  /** Whether the iteration was finished, as opposed to Lapsed, Missed or Expired. Drives the
   * `9 done, 5 missed` half of a group's tally. */
  done: boolean;
}

/** Which unit of time a `habit_group` node stands for. `run` is the whole folded run; the rest are
 * the scope levels its expansion inserts, `year` being a display-only grouping above Season. */
export type HabitGroupLevel = "run" | "year" | "season" | "month" | "week";

/** What a `habit_group` node stands for: a run of passed Habit iterations, or one scope level of
 * that run's expansion. It has no DB row, no status and no filter of its own — it is the tally and
 * the span, and everything else about it is read from the iterations behind it. */
export interface HabitGroup {
  flowId: number;
  level: HabitGroupLevel;
  /** How many passed iterations this node stands for. */
  passed: number;
  /** How many of them finished. */
  done: number;
  /** How many did not — Lapsed, Missed or Expired alike. */
  missed: number;
  /** First day of the earliest iteration behind it, ISO `YYYY-MM-DD`. */
  spanStart: string;
  /** Last day of the latest iteration behind it, ISO `YYYY-MM-DD`. */
  spanEnd: string;
  /** The span in words, for the node's tooltip. */
  spanLabel: string;
}

export interface MindmapNode {
  /** The node's display key: unique and comparable, **not** an address — never parse it. Read the
   * row through `rowId` (via `rowIdOf`). A node kind added from now on mints a UUID here rather
   * than a composed string; see docs/spec/mindmap-view.md, "Node identity". */
  id: string;
  /** The database row this node draws, in its kind's table. Absent exactly when the node draws no
   * row: a `virtual` node, or the synthetic tree root. */
  rowId?: number;
  kind: NodeKind;
  title: string;
  status?: string;
  /** Explicit block reasons (ordered), editable in the task/goal editor. */
  blockReasons?: string[];
  /** Derived, read-only "Blocked by …" reasons from this task's unmet dependencies. */
  virtualBlockers?: string[];
  knowledgeBaseDirectory?: string | null;
  /** Optional multi-line details on an `info` node (e.g. a traceback). */
  infoDetails?: string | null;
  color?: string;
  timeScope?: TimeScope | null;
  /** On-exit behavior; present iff `timeScope` is (Task/Goal only). */
  onScopeExit?: OnScopeExit | null;
  /** Derived window position at "now" (Task/Goal only); set by the view, never persisted. */
  timing?: Timing;
  /** Derived resolution outcome once `timing` is "lapsed" (Task/Goal only). */
  resolution?: Resolution;
  /** Effective archived-ness (Task/Goal only) — true forces the archived badge/filter regardless of
   * `status`; may diverge from a manually-set Frozen `status` (see `archivalConflict`). */
  archived?: boolean;
  /** True when `archived` is true because a scope Resolution overrode a manually-set Frozen status
   * or a stored Backlog. */
  archivalConflict?: boolean;
  /** The task's own **stored** Backlog state (Tasks only) — deliberately set aside, hidden from
   * Plan and Start with its whole subtree, still listed under All. Stored rather than derived, so
   * it keeps reading as backlogged even once a lapsed window has forced `archived` on top of it —
   * exactly as a Frozen goal keeps its `status` under the same override. */
  backlogged?: boolean;
  /** The task's **own** Agentic flag (Tasks only): work that suits being handed to an agent.
   * `null`/absent means it has none of its own and reads its nearest flagged ancestor's instead
   * (see `inheritedAgentic`). Independent of the delegate: a Task can be both. */
  agentic?: boolean | null;
  /** What this node's ancestors say about Agentic — resolved on load by `propagateAgentic`, never
   * persisted. Read together with `agentic` through `isAgentic`, never on its own: an explicit
   * `agentic: false` overrides an agentic ancestor. */
  inheritedAgentic?: boolean;
  /** Who holds this Task, when it is delegated (Tasks only): a Person or the Agent. The task's
   * **own** stored delegate — absent or `null` when it has none of its own. */
  delegate?: Delegate | null;
  /** Whether doing this Task starts a **wait** rather than finishing something (Tasks only) —
   * send the email, order the part, kick off the build. Its own flag; `asyncTemplate` is optional.
   *
   * Deliberately **not** inherited, unlike `agentic`: "starts a wait" is a property of one
   * concrete action, and a subtask of an asynchronous Task is usually the work you do *after* the
   * wait. There is no `inheritedAsynchronous` for that reason, and there should not be one. */
  asynchronous?: boolean;
  /** A Commitment's recorded Verdict (Commitments only) — `unresolved` / `kept` / `broken`.
   * Never derived from the window passing or from children completing: `unresolved` means the
   * user has not said, which is information in its own right. */
  verdict?: Verdict;
  /** A Commitment's **own** Verdict Window, when it sets one (Commitments only). How long past
   * the end of its window it stays answerable, as a count of any scope kind. Absent means it
   * inherits the nearest ancestor Commitment's. */
  verdictWindow?: DurationSpec | null;
  /** A derived, read-only node (e.g. a virtual Habit iteration) with no backing DB row. */
  virtual?: boolean;
  /** An Expectation's **Check every** (Expectations only): how often to look in on the wait. While
   * it is pending, a virtual check task hangs beneath it, due one interval after the last check.
   * `status` carries the Expectation's `pending`/`released`, and `archived` its archive. */
  checkEvery?: DurationSpec | null;
  /** When a stored wait's first check fell due, ISO local time. */
  checkStarting?: string | null;
  /** Present on a wait's virtual **check task** — a `task`-kind node with no row. Completing it
   * records the check on the wait named here and stores nothing else. */
  expectationCheck?: WaitRef;
  /** On a **completed** check task: when that check fell due, which names it for reopening. */
  checkDueAt?: string;
  /** Present on the virtual wait an **Asynchronous** Task spawned while it is done: the Task. Its
   * title and tags are the Task's template; its state is the overlay keyed by the Task. */
  spawnedBy?: { taskId: number };
  /** A Task's optional **Expectation template** (Tasks only), kept only while `asynchronous`: while
   * the Task is done, a virtual wait is drawn from it. */
  asyncTemplate?: AsyncTemplate | null;
  /** The Task's own **agentic brief** (Tasks only): priority, Spec, Design, Acceptance criteria and
   * Notes — what an agent reads about the work. Never inherited, unlike Agentic; shown while the
   * Task reads as Agentic. `null` when it has none. */
  agenticBrief?: AgenticBrief | null;
  /** Present on an **agentic wait** (Expectations only): one an agent raised on the Agentic Task
   * it hangs under — "the agent is waiting on you". `note` is its question, and the answer once
   * the user writes one in. */
  agentWaiting?: { note: string | null };
  /** The stored Expectations this Task depends on, by row id (Tasks only). */
  expectationDependencyIds?: number[];
  /** Present on the virtual Expectation a **delegated** Task waits on: the Task it belongs to. It
   * has no row, and it is released only by the Task being done — never by hand. */
  delegationWait?: { taskId: number };
  /**
   * Present on any virtual Habit instance — a per-iteration flow-item instance, or the iteration
   * **root** itself (`itemType: "flow_root"`, `itemId` = the flow id). Carries the
   * (flow, instance, iteration scope, cycle pair) its status click toggles. `cycleId` is what
   * separates one occurrence of an item from another in the same iteration — an item with a
   * morning and an evening cycle pair draws two nodes on the same day — and is `NO_CYCLE` for an
   * item with no pairs, and for the root.
   */
  habitItem?: {
    flowId: number;
    itemType: HabitInstanceType;
    itemId: number;
    scopeId: ScopeKey;
    cycleId: number;
  };
  /** Present on a virtual Habit **iteration root** — what the Mindmap's collapse of passed
   * iterations reads off it. Absent on the occurrences beneath it, which never fold on their own. */
  habitIteration?: HabitIterationMeta;
  /** Present on a `habit_group` node, and on no other kind: what it stands for. */
  habitGroup?: HabitGroup;
  plan?: TimeScope | null;
  /** Where this Task's **own** Plan stands at "now" (real Tasks with a Plan only); set by the view
   * from the derived lifecycle, never persisted. Absent on a virtual Habit occurrence, whose Cycle
   * Plan the Start preset does not read. */
  planTiming?: Timing;
  flow?: FlowData;
  flowItem?: FlowItemData;
  /** Whether this node is marked private — hidden (with its subtree) outside Private Mode. */
  isPrivate?: boolean;
  /** The `bd` issue this Task, Goal or Project is tracked as; absent when it is tracked as none.
   * Read-only in this app — only the MCP server writes it. */
  beadsId?: string;
  /** Present when the MCP can see this node: the title of the MCP root it is seen through. Set on
   * load from the backend's own resolution (`list_mcp_access`), never persisted; a derived node
   * takes its nearest stored ancestor's. See docs/spec/mcp-server.md, "Access". */
  mcpVisibleVia?: string;
  /** Whether this real Goal/Task was materialized by a started flow (drives the flow-instance badge). */
  fromFlow?: boolean;
  position: number;
  tagIds: number[];
  children: MindmapNode[];
}

export interface Position {
  x: number;
  y: number;
  depth: number;
}

export const HORIZONTAL_GAP = 220;
export const VERTICAL_GAP = 90;

/** Clear space kept between two drawn node boxes — badge rows included — beyond the gaps above. */
export const NODE_CLEARANCE = 12;

/**
 * How far a drawn node reaches above and below its centre, on screen: half its box upwards, and
 * half its box plus its status-badge row, when it has one, downwards.
 */
export interface NodeExtent {
  above: number;
  below: number;
}

/** Measures a node as it will be drawn at `depth` (distance from the display root). */
export type NodeMeasure = (node: MindmapNode, depth: number) => NodeExtent;

/**
 * Which axis branches grow along: `horizontal` spreads them left/right of the root,
 * `vertical` spreads them down/up.
 */
export type Orientation = "horizontal" | "vertical";

/**
 * Computes pixel positions for every visible node in a balanced mind map.
 *
 * Root sits at (0, 0). The first ⌈n/2⌉ children take the positive direction along the
 * orientation's branch axis (right when horizontal, down when vertical); the remainder take
 * the negative one. depth reflects distance from the display root.
 */
export function computeLayout(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
  orientation: Orientation = "horizontal",
  measure?: NodeMeasure,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0, depth: 0 });

  const visibleChildren = root.children.filter((child) => child !== undefined);
  if (visibleChildren.length === 0) return positions;

  const splitIndex = Math.ceil(visibleChildren.length / 2);
  const positiveChildren = visibleChildren.slice(0, splitIndex);
  const negativeChildren = visibleChildren.slice(splitIndex);

  layoutSubtree(root, positiveChildren, collapsedIds, positions, 1, orientation, measure);
  layoutSubtree(root, negativeChildren, collapsedIds, positions, -1, orientation, measure);

  return positions;
}

/**
 * Lays `children` of `origin` out on one side of it.
 *
 * With no `measure` every node is spaced by the fixed gaps. With one, a node's drawn size — its
 * wrapped title and its status-badge row — is reserved too, wherever that size runs along an axis
 * the fixed gap could come up short on: between siblings stacked top to bottom (the horizontal
 * layout's breadth), and between levels stacked top to bottom (the vertical layout's depth). The
 * fixed gap stays the minimum, so a small node is spaced exactly as it always was.
 */
function layoutSubtree(
  origin: MindmapNode,
  children: MindmapNode[],
  collapsedIds: ReadonlySet<string>,
  positions: Map<string, Position>,
  direction: 1 | -1,
  orientation: Orientation,
  measure?: NodeMeasure,
): void {
  if (children.length === 0) return;

  const virtualRoot: MindmapNode = {
    id: "__virtual__",
    kind: "domain",
    title: "",
    position: 0,
    tagIds: [],
    children,
  };

  const isVertical = orientation === "vertical";
  // d3.tree lays out on [breadth, depth]. Sibling spacing must clear the widest node on the
  // breadth axis, so the two gaps swap roles with the orientation.
  const breadthGap = isVertical ? HORIZONTAL_GAP : VERTICAL_GAP;
  const depthGap = isVertical ? VERTICAL_GAP : HORIZONTAL_GAP;

  const pruned = pruneCollapsed(virtualRoot, collapsedIds);
  const rootHierarchy = hierarchy(pruned, (node) => node.children);
  // A breadth unit of one pixel, so `separation` answers in pixels: d3's own rule (cousins twice
  // as far apart as siblings) times the fixed gap, raised to what the two nodes actually need.
  const layout = tree<MindmapNode>()
    .nodeSize([1, depthGap])
    .separation((a, b) => {
      const fixed = (a.parent === b.parent ? 1 : 2) * breadthGap;
      if (isVertical || measure === undefined) return fixed;
      const first = measure(a.data, a.depth);
      const second = measure(b.data, b.depth);
      // Which of the two ends up on top is d3's business, so reserve for either order.
      const needed = Math.max(first.below + second.above, second.below + first.above) + NODE_CLEARANCE;
      return Math.max(fixed, needed);
    });
  const pointRoot = layout(rootHierarchy);

  const levelOffset = isVertical && measure !== undefined
    ? verticalLevelOffsets(origin, pointRoot, direction, measure)
    : null;

  pointRoot.each((node) => {
    if (node.data.id === "__virtual__") return;
    const depthOffset = levelOffset?.[node.depth] ?? node.y;
    // d3.tree: x = breadth, y = depth. Vertical keeps that mapping; horizontal rotates it.
    positions.set(node.data.id, {
      x: isVertical ? node.x : direction * depthOffset,
      y: isVertical ? direction * depthOffset : node.x,
      depth: node.depth,
    });
  });
}

/**
 * Distance of each level from the origin in the vertical layout, where levels stack top to
 * bottom: each level sits far enough from the one before that the lower row's boxes clear the
 * upper row's boxes and badge rows. Never closer than the fixed gap.
 */
function verticalLevelOffsets(
  origin: MindmapNode,
  pointRoot: HierarchyPointNode<MindmapNode>,
  direction: 1 | -1,
  measure: NodeMeasure,
): number[] {
  const extents: NodeExtent[] = [measure(origin, 0)];
  pointRoot.each((node) => {
    if (node.depth === 0) return;
    const extent = measure(node.data, node.depth);
    const level = extents[node.depth];
    extents[node.depth] = level === undefined
      ? extent
      : { above: Math.max(level.above, extent.above), below: Math.max(level.below, extent.below) };
  });

  const offsets = [0];
  for (let depth = 1; depth < extents.length; depth += 1) {
    const inner = extents[depth - 1] ?? { above: 0, below: 0 };
    const outer = extents[depth] ?? { above: 0, below: 0 };
    // Growing down, the inner level's bottom meets the outer level's top; growing up, the other way.
    const needed = direction === 1 ? inner.below + outer.above : inner.above + outer.below;
    offsets.push((offsets[depth - 1] ?? 0) + Math.max(VERTICAL_GAP, needed + NODE_CLEARANCE));
  }
  return offsets;
}

/**
 * Computes positions for a subtree rooted at `root`, placing it at (0, 0) and
 * all descendants on the given side. Used to render the drag placeholder subtree.
 */
export function computeSubtreeLayout(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
  direction: 1 | -1,
  orientation: Orientation = "horizontal",
  measure?: NodeMeasure,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0, depth: 0 });
  if (!collapsedIds.has(root.id) && root.children.length > 0) {
    layoutSubtree(root, root.children, collapsedIds, positions, direction, orientation, measure);
  }
  return positions;
}

function pruneCollapsed(node: MindmapNode, collapsedIds: ReadonlySet<string>): MindmapNode {
  if (collapsedIds.has(node.id)) {
    return { ...node, children: [] };
  }
  return {
    ...node,
    children: node.children.map((child) => pruneCollapsed(child, collapsedIds)),
  };
}
