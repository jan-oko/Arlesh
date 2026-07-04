import { hierarchy, tree } from "d3-hierarchy";
import type { TimeScope } from "@/api/time-scope";
import type { InstanceType, FlowItemType, HabitInstanceType } from "@/api/flows";
import type { OnScopeExit, ScopeLifecycle } from "@/api/scope-lifecycle";

export type NodeKind =
  | "aspect" | "project" | "domain" | "goal" | "task" | "tag" | "info"
  | "flow" | "flow_goal" | "flow_task";

/** The four subtypes stored in the single `domains` table — all keyed `domain-<id>` in the tree. */
const DOMAIN_TABLE_KINDS: ReadonlySet<string> = new Set(["aspect", "project", "domain", "tag"]);

/**
 * The tree node id for an entity referenced by its `(type, id)` (e.g. a flow's stored target or
 * parent). Domain-table subtypes (aspect/project/domain/tag) share the single `domain-<id>`
 * namespace; goal/task keep their own. Never build `` `${type}-${id}` `` directly — a `project`
 * target would resolve to `project-<id>`, which no tree node uses, and silently miss.
 */
export function entityNodeId(type: string, id: number): string {
  return DOMAIN_TABLE_KINDS.has(type) ? `domain-${id}` : `${type}-${id}`;
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
  flowScopeN: number | null;
  flowScopeKind: string | null;
  cycles: FlowCyclePair[];
  dependsOn: FlowItemDep[];
}

export interface MindmapNode {
  id: string;
  kind: NodeKind;
  title: string;
  status?: string;
  blockedReason?: string | null;
  knowledgeBaseDirectory?: string | null;
  /** Optional multi-line details on an `info` node (e.g. a traceback). */
  infoDetails?: string | null;
  color?: string;
  timeScope?: TimeScope | null;
  /** On-exit behavior; present iff `timeScope` is (Task/Goal only). */
  onScopeExit?: OnScopeExit | null;
  /** Derived scope lifecycle at "now" (Task/Goal only); set by the view, never persisted. */
  scopeLifecycle?: ScopeLifecycle;
  /** A derived, read-only node (e.g. a virtual Habit iteration) with no backing DB row. */
  virtual?: boolean;
  /**
   * Present on any virtual Habit instance — a per-iteration flow-item instance, or the iteration
   * **root** itself (`itemType: "flow_root"`, `itemId` = the flow id). Carries the
   * (flow, instance, iteration scope) its status click toggles.
   */
  habitItem?: { flowId: number; itemType: HabitInstanceType; itemId: number; scopeId: number };
  plan?: TimeScope | null;
  flow?: FlowData;
  flowItem?: FlowItemData;
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

/**
 * Computes pixel positions for every visible node in a left-right balanced mind map.
 *
 * Root sits at (0, 0). The first ⌈n/2⌉ children go right (positive x);
 * the remainder go left (negative x). depth reflects distance from the display root.
 */
export function computeLayout(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0, depth: 0 });

  const visibleChildren = root.children.filter((child) => child !== undefined);
  if (visibleChildren.length === 0) return positions;

  const splitIndex = Math.ceil(visibleChildren.length / 2);
  const rightChildren = visibleChildren.slice(0, splitIndex);
  const leftChildren = visibleChildren.slice(splitIndex);

  layoutSubtree(rightChildren, collapsedIds, positions, 1);
  layoutSubtree(leftChildren, collapsedIds, positions, -1);

  return positions;
}

function layoutSubtree(
  children: MindmapNode[],
  collapsedIds: ReadonlySet<string>,
  positions: Map<string, Position>,
  direction: 1 | -1,
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

  const pruned = pruneCollapsed(virtualRoot, collapsedIds);
  const rootHierarchy = hierarchy(pruned, (node) => node.children);
  const layout = tree<MindmapNode>().nodeSize([VERTICAL_GAP, HORIZONTAL_GAP]);
  const pointRoot = layout(rootHierarchy);

  pointRoot.each((node) => {
    if (node.data.id === "__virtual__") return;
    // d3.tree: x = breadth, y = depth; rotate to horizontal layout
    positions.set(node.data.id, {
      x: direction * node.y,
      y: node.x,
      depth: node.depth,
    });
  });
}

/**
 * Computes positions for a subtree rooted at `root`, placing it at (0, 0) and
 * all descendants on the given side. Used to render the drag placeholder subtree.
 */
export function computeSubtreeLayout(
  root: MindmapNode,
  collapsedIds: ReadonlySet<string>,
  direction: 1 | -1,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0, depth: 0 });
  if (!collapsedIds.has(root.id) && root.children.length > 0) {
    layoutSubtree(root.children, collapsedIds, positions, direction);
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
