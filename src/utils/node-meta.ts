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

/**
 * Returns which types Ctrl+Up/Down may cycle through for a given node.
 * Domain-table nodes (domain, project, tag) cycle among themselves.
 * Goal/task cycle between each other, except a task under a task cannot
 * become a goal ("goal child of task" is an invalid parent relationship).
 */
export function validTypesForCycling(kind: NodeKind, parentKind: NodeKind | null): NodeKind[] {
  if (kind === "domain" || kind === "project" || kind === "tag") {
    return ["domain", "project", "tag"];
  }
  if (kind === "task" && parentKind === "task") {
    return ["task"];
  }
  if (kind === "goal" || kind === "task") {
    return ["goal", "task"];
  }
  return [];
}

/** Returns true if the type transition crosses the Goal↔Task boundary. */
export function crossesGoalTaskBoundary(from: NodeKind, to: NodeKind): boolean {
  const goalTask = new Set<NodeKind>(["goal", "task"]);
  return goalTask.has(from) && goalTask.has(to);
}
