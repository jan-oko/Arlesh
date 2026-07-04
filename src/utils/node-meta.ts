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

/**
 * Estimates the visual line count for arbitrary text within a given text area,
 * using the same character-width heuristic as `computeNodeDimensions`.
 * Use this in the textarea `onChange` handler to keep edit-mode height in sync.
 */
export function estimateWrappedLineCount(text: string, textAreaWidth: number, fontSize: number): number {
  const charsPerLine = Math.max(1, Math.floor(textAreaWidth / (fontSize * CHAR_WIDTH_RATIO)));
  return countWrappedLines(text, charsPerLine);
}

export const NODE_ICON: Record<NodeKind, string> = {
  aspect: "◆",
  project: "📁",
  domain: "◻",
  goal: "◇",
  task: "✓",
  tag: "🏷",
  info: "ℹ",
  flow: "▶",
  flow_goal: "◇",
  flow_task: "✓",
};

export const NODE_LABEL: Record<NodeKind, string> = {
  aspect: "Aspect",
  project: "Project",
  domain: "Domain",
  goal: "Goal",
  task: "Task",
  tag: "Tag",
  info: "Info",
  flow: "Flow",
  flow_goal: "Goal",
  flow_task: "Task",
};

// All node types reachable from a domain-table parent (aspect/domain/project/tag).
const DOMAIN_PARENT_CYCLE: NodeKind[] = ["domain", "project", "tag", "goal", "task", "info"];

// Which direct-child kinds each kind may hold, from the backend's parent_type CHECK constraints
// (goals: project|goal|domain, tasks: +task, flows: aspect|project|domain|goal, infos: anywhere;
// projects need an aspect/project parent, tags can't nest). Used to hide a retype that would strand
// an existing child under a type that can't hold it.
const ALLOWED_CHILD_KINDS: Partial<Record<NodeKind, NodeKind[]>> = {
  aspect: ["project", "domain", "tag", "goal", "task", "info", "flow"],
  project: ["project", "domain", "tag", "goal", "task", "info", "flow"],
  domain: ["domain", "tag", "goal", "task", "info", "flow"],
  tag: ["goal", "task", "info"],
  goal: ["goal", "task", "info", "flow"],
  task: ["task", "info"],
  info: ["info"],
};

/** Whether `target` can hold every one of `childKinds` as a direct child (an empty list is always ok). */
export function typeAcceptsChildren(target: NodeKind, childKinds: readonly NodeKind[]): boolean {
  const allowed = ALLOWED_CHILD_KINDS[target] ?? [];
  return childKinds.every((kind) => allowed.includes(kind));
}

/**
 * Returns which types Ctrl+Up/Down may cycle through for a given node.
 *
 * Under a domain/project/aspect/tag parent the full cycle is available.
 * Under a goal parent only goal, task, and info are valid.
 * Under a task parent only task and info are valid.
 * Under an info parent only info is valid (info nodes can only have info children).
 */
export function validTypesForCycling(kind: NodeKind, parentKind: NodeKind | null): NodeKind[] {
  if (kind === "aspect") return [];

  // The flow node itself is not part of the type cycle.
  if (kind === "flow") return [];

  // Flow items retype between goal and task, mirroring real nodes: a goal child is invalid
  // under a flow-task parent, so only flow-tasks may sit there.
  if (kind === "flow_goal" || kind === "flow_task") {
    return parentKind === "flow_task" ? ["flow_task"] : ["flow_goal", "flow_task"];
  }

  // Info nodes can only have info children — no cycling out.
  if (parentKind === "info") return ["info"];

  const hasDomainParent =
    parentKind === "aspect" ||
    parentKind === "domain" ||
    parentKind === "project" ||
    parentKind === "tag" ||
    parentKind === null; // virtual root (shouldn't cycle, but safe)

  if (hasDomainParent) {
    // Not every domain-table kind is valid under every parent (the backend would reject it):
    // a Project must sit under an Aspect or Project, and a Tag cannot sit under a Tag.
    return DOMAIN_PARENT_CYCLE.filter((kind) => {
      if (kind === "project") return parentKind === "aspect" || parentKind === "project";
      if (kind === "tag") return parentKind !== "tag";
      return true;
    });
  }

  // Under a task: goal child is invalid, but info is valid.
  if (parentKind === "task") return ["task", "info"];

  // Under a goal: goal, task, and info are all valid children.
  return ["goal", "task", "info"];
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
 *   aspect / domain / project  → domain, project, tag, goal, task, info children
 *   goal                       → goal, task, info children
 *   task                       → task, info children
 *   info                       → info children only
 *   tag                        → no children (leaf)
 *   aspect                     → cannot be moved (immutable)
 */
export function isValidDropTarget(sourceKind: NodeKind, targetKind: NodeKind): boolean {
  if (sourceKind === "aspect") return false;

  // Flows and flow items live in their own world — they never mix with real nodes.
  const isFlowKind = (k: NodeKind): boolean => k === "flow" || k === "flow_goal" || k === "flow_task";
  if (isFlowKind(sourceKind) || isFlowKind(targetKind)) {
    if (sourceKind === "flow") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project" || targetKind === "goal";
    if (sourceKind === "flow_goal") return targetKind === "flow" || targetKind === "flow_goal";
    if (sourceKind === "flow_task") return targetKind === "flow" || targetKind === "flow_goal" || targetKind === "flow_task";
    return false; // a real node can never drop onto a flow or flow item
  }

  if (targetKind === "tag") return false;
  if (targetKind === "info") return sourceKind === "info";
  if (sourceKind === "info") return true;
  if (sourceKind === "project") return targetKind === "aspect" || targetKind === "project";
  if (sourceKind === "domain") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "tag") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "goal") return targetKind !== "task";
  // task: valid under aspect, domain, project, goal, or task
  return true;
}
