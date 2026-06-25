import type { NodeKind } from "./tree-layout";

export interface NodeSize {
  width: number;
  height: number;
  fontSize: number;
  iconWidth: number;
  lineHeight: number;
  lineCount: number;
}

interface BaseNodeSpec {
  width: number;
  minHeight: number;
  fontSize: number;
  iconWidth: number;
  lineHeight: number;
}

const NODE_SPECS: readonly BaseNodeSpec[] = [
  { width: 200, minHeight: 52, fontSize: 18, iconWidth: 32, lineHeight: 22 },
  { width: 180, minHeight: 44, fontSize: 15, iconWidth: 28, lineHeight: 19 },
  { width: 160, minHeight: 36, fontSize: 13, iconWidth: 22, lineHeight: 17 },
  { width: 148, minHeight: 32, fontSize: 12, iconWidth: 20, lineHeight: 16 },
  { width: 140, minHeight: 30, fontSize: 11, iconWidth: 18, lineHeight: 15 },
];

const CHAR_WIDTH_RATIO = 0.52;
const VERTICAL_PADDING = 8;

function specForDepth(depth: number): BaseNodeSpec {
  const index = Math.min(depth, NODE_SPECS.length - 1);
  return NODE_SPECS[index] ?? NODE_SPECS[NODE_SPECS.length - 1]!;
}

function nodeHeight(spec: BaseNodeSpec, lineCount: number): number {
  return Math.max(spec.minHeight, VERTICAL_PADDING + lineCount * spec.lineHeight);
}

function countWrappedLines(title: string, charsPerLine: number): number {
  const segments = title.split("\n");
  let total = 0;
  for (const seg of segments) {
    total += Math.max(1, Math.ceil(seg.length / charsPerLine));
  }
  return Math.max(1, total);
}

/** Returns base (minimum) node dimensions for a depth — does not account for title length. */
export function getNodeSize(depth: number): NodeSize {
  const spec = specForDepth(depth);
  return { width: spec.width, height: spec.minHeight, fontSize: spec.fontSize, iconWidth: spec.iconWidth, lineHeight: spec.lineHeight, lineCount: 1 };
}

/** Returns node dimensions with height expanded to fit `title` across wrapped lines. */
export function computeNodeDimensions(depth: number, title: string): NodeSize {
  const spec = specForDepth(depth);
  const textAreaWidth = spec.width - spec.iconWidth - 4;
  const charsPerLine = Math.max(1, Math.floor(textAreaWidth / (spec.fontSize * CHAR_WIDTH_RATIO)));
  const lineCount = countWrappedLines(title, charsPerLine);
  return { width: spec.width, height: nodeHeight(spec, lineCount), fontSize: spec.fontSize, iconWidth: spec.iconWidth, lineHeight: spec.lineHeight, lineCount };
}

/** Returns the live node height for an explicit line count — used while editing. */
export function computeEditHeight(depth: number, lineCount: number): number {
  return nodeHeight(specForDepth(depth), lineCount);
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

/**
 * Returns true if `sourceKind` is a valid child of `targetKind`.
 *
 * Parent rules:
 *   aspect / domain / project  → domain, project, tag, goal, task children
 *   goal                       → goal, task children
 *   task                       → task children only
 *   tag                        → no children (leaf)
 *   aspect                     → cannot be moved (immutable)
 */
export function isValidDropTarget(sourceKind: NodeKind, targetKind: NodeKind): boolean {
  if (sourceKind === "aspect") return false;
  if (targetKind === "tag") return false;
  if (sourceKind === "project") return targetKind === "aspect" || targetKind === "project";
  if (sourceKind === "domain") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "tag") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "goal") return targetKind !== "task";
  // task: valid under aspect, domain, project, goal, or task
  return true;
}
