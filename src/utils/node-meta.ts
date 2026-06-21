import type { NodeKind } from "./tree-layout";

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
