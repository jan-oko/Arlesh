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
};

export const NODE_LABEL: Record<NodeKind, string> = {
  aspect: "Aspect",
  project: "Project",
  domain: "Domain",
  goal: "Goal",
  task: "Task",
};

/** The cycle order for Ctrl+Up / Ctrl+Down type switching. Aspects are excluded. */
export const TYPE_CYCLE: NodeKind[] = ["domain", "project", "goal", "task"];

export function nextType(kind: NodeKind): NodeKind {
  const index = TYPE_CYCLE.indexOf(kind);
  if (index === -1) return kind;
  return TYPE_CYCLE[(index + 1) % TYPE_CYCLE.length] as NodeKind;
}

export function prevType(kind: NodeKind): NodeKind {
  const index = TYPE_CYCLE.indexOf(kind);
  if (index === -1) return kind;
  return TYPE_CYCLE[(index - 1 + TYPE_CYCLE.length) % TYPE_CYCLE.length] as NodeKind;
}

/** Returns true if the type transition crosses the Goal↔Task boundary. */
export function crossesGoalTaskBoundary(from: NodeKind, to: NodeKind): boolean {
  const goalTask = new Set<NodeKind>(["goal", "task"]);
  return goalTask.has(from) && goalTask.has(to);
}
