import type { NodeKind } from "./tree-layout";

export interface NodeSize {
  width: number;
  height: number;
  fontSize: number;
  iconWidth: number;
  maxChars: number;
}

const NODE_SIZES: readonly NodeSize[] = [
  { width: 200, height: 52, fontSize: 18, iconWidth: 32, maxChars: 20 },
  { width: 180, height: 44, fontSize: 15, iconWidth: 28, maxChars: 18 },
  { width: 160, height: 36, fontSize: 13, iconWidth: 22, maxChars: 16 },
  { width: 148, height: 32, fontSize: 12, iconWidth: 20, maxChars: 15 },
  { width: 140, height: 30, fontSize: 11, iconWidth: 18, maxChars: 14 },
];

export function getNodeSize(depth: number): NodeSize {
  const index = Math.min(depth, NODE_SIZES.length - 1);
  return NODE_SIZES[index] ?? NODE_SIZES[NODE_SIZES.length - 1]!;
}

export const NODE_ICON: Record<NodeKind, string> = {
  aspect: "◆",
  project: "📁",
  domain: "◻",
  goal: "◇",
  task: "✓",
  tag: "🏷",
};

export const NODE_LABEL: Record<NodeKind, string> = {
  aspect: "Aspect",
  project: "Project",
  domain: "Domain",
  goal: "Goal",
  task: "Task",
  tag: "Tag",
};

// All node types reachable from a domain-table parent (aspect/domain/project/tag).
const DOMAIN_PARENT_CYCLE: NodeKind[] = ["domain", "project", "tag", "goal", "task"];

/**
 * Returns which types Ctrl+Up/Down may cycle through for a given node.
 *
 * Under a domain/project/aspect/tag parent the full cycle is available since
 * tasks and goals are valid children of those nodes.
 * Under a goal parent only goal↔task is valid.
 * A task under another task cannot become a goal (goals cannot be children of tasks).
 */
export function validTypesForCycling(kind: NodeKind, parentKind: NodeKind | null): NodeKind[] {
  if (kind === "aspect") return [];

  const hasDomainParent =
    parentKind === "aspect" ||
    parentKind === "domain" ||
    parentKind === "project" ||
    parentKind === "tag" ||
    parentKind === null; // virtual root (shouldn't cycle, but safe)

  if (hasDomainParent) {
    return DOMAIN_PARENT_CYCLE;
  }

  // Under a task: goal child is invalid, so no cycling possible.
  if (parentKind === "task") return ["task"];

  // Under a goal: goal and task are both valid children.
  return ["goal", "task"];
}

/** Returns true if the type transition crosses the Goal↔Task boundary. */
export function crossesGoalTaskBoundary(from: NodeKind, to: NodeKind): boolean {
  const goalTask = new Set<NodeKind>(["goal", "task"]);
  return goalTask.has(from) && goalTask.has(to);
}
