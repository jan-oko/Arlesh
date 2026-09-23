import type { MindmapNode, NodeKind } from "./tree-layout";
import { ALL_NODE_KINDS } from "./tree-layout";
import type { InstanceType } from "@/api/flows";

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
  // A handshake: a rule you hold to, not a box you tick.
  commitment: "🤝",
  tag: "🏷",
  info: "ℹ",
  flow: "▶",
  flow_goal: "◇",
  flow_task: "✓",
  // A stack of folded history, not a thing in its own right.
  habit_group: "▤",
};

export const NODE_LABEL: Record<NodeKind, string> = {
  aspect: "Aspect",
  project: "Project",
  domain: "Domain",
  goal: "Goal",
  task: "Task",
  commitment: "Commitment",
  tag: "Tag",
  info: "Info",
  flow: "Flow",
  flow_goal: "Goal",
  flow_task: "Task",
  habit_group: "Habit history",
};

// All node types reachable from a domain-table parent (aspect/domain/project/tag). Commitment
// sits immediately after Task, which is the position SPEC gives it in the Ctrl+Up/Down cycle.
const DOMAIN_PARENT_CYCLE: NodeKind[] = [
  "domain", "project", "tag", "goal", "task", "commitment", "info",
];

// Which direct-child kinds each kind may hold, from the backend's parent_type CHECK constraints
// (goals: project|goal|domain, tasks: +task, flows: aspect|project|domain|goal, infos: anywhere;
// projects need an aspect/project parent, tags can't nest). Used to hide a retype that would strand
// an existing child under a type that can't hold it.
const ALLOWED_CHILD_KINDS: Partial<Record<NodeKind, NodeKind[]>> = {
  aspect: ["project", "domain", "tag", "goal", "task", "commitment", "info", "flow"],
  project: ["project", "domain", "tag", "goal", "task", "commitment", "info", "flow"],
  domain: ["domain", "tag", "goal", "task", "commitment", "info", "flow"],
  tag: ["info"], // a tag is a label — it holds only info notes, no structural children
  goal: ["goal", "task", "commitment", "info", "flow"],
  task: ["task", "commitment", "info"],
  // The supporting steps under a rule, and the finer-grained rules inside it. Not a Goal: a
  // desired state is not something you hold to over a window.
  commitment: ["task", "commitment", "info"],
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
 *
 * `flowInstanceType` is the owning flow's Instance Type, for a flow item. It matters for exactly
 * one case: a **commitment** flow holds no goal items, because a Commitment cannot parent a Goal —
 * so `flow_goal` is not offered there. The pair of kinds alone could not tell, which is how a flow
 * task on a commitment flow used to be one keystroke from a state that derives no iterations at
 * all and is only explained afterwards, by the Mindmap's failure banner.
 */
export function validTypesForCycling(
  kind: NodeKind,
  parentKind: NodeKind | null,
  flowInstanceType?: InstanceType,
): NodeKind[] {
  if (kind === "aspect") return [];

  // The flow node itself is not part of the type cycle.
  if (kind === "flow") return [];

  // A folded run of Habit iterations is a way of drawing them, not a node of its own: there is
  // nothing behind it to retype.
  if (kind === "habit_group") return [];

  // Flow items retype between goal and task, mirroring real nodes: a goal child is invalid
  // under a flow-task parent, so only flow-tasks may sit there.
  if (kind === "flow_goal" || kind === "flow_task") {
    if (parentKind === "flow_task" || flowInstanceType === "commitment") return ["flow_task"];
    return ["flow_goal", "flow_task"];
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

  // Under a task: goal child is invalid, but the rest are valid.
  if (parentKind === "task") return ["task", "commitment", "info"];

  // Under a commitment: the same three. A commitment holds no goals.
  if (parentKind === "commitment") return ["task", "commitment", "info"];

  // Under a goal: goal, task, commitment and info are all valid children.
  return ["goal", "task", "commitment", "info"];
}

/** Returns true if the type transition crosses the Goal↔Task boundary. */
export function crossesGoalTaskBoundary(from: NodeKind, to: NodeKind): boolean {
  const goalTask = new Set<NodeKind>(["goal", "task"]);
  return goalTask.has(from) && goalTask.has(to);
}

/**
 * Whether `kind` lives inside a Flow — the Flow itself, or one of its items.
 *
 * One definition, because two would let the drop rule and the message that explains a refusal
 * disagree about where the boundary between the flow world and the real one runs.
 */
export function isFlowKind(kind: NodeKind): boolean {
  return kind === "flow" || kind === "flow_goal" || kind === "flow_task";
}

/**
 * Returns true if `sourceKind` is a valid child of `targetKind`.
 *
 * Parent rules:
 *   aspect / domain / project  → domain, project, tag, goal, task, commitment, info children
 *   goal                       → goal, task, commitment, info children
 *   task                       → task, commitment, info children
 *   commitment                 → task, commitment, info children
 *   info                       → info children only
 *   tag                        → info children only (a label, annotated — nothing structural)
 *   aspect                     → cannot be moved (immutable)
 */
export function isValidDropTarget(sourceKind: NodeKind, targetKind: NodeKind): boolean {
  if (sourceKind === "aspect") return false;

  // A `habit_group` is a *drawing* of a run of iterations — a tally and a span — and is neither a
  // thing to move nor a place to move one to. It is named here because it is exactly what the old
  // fall-through let through: every source that reached the bottom of this function was permitted
  // under a folded run of Habit history.
  if (sourceKind === "habit_group" || targetKind === "habit_group") return false;

  // Flows and flow items live in their own world — they never mix with real nodes.
  if (isFlowKind(sourceKind) || isFlowKind(targetKind)) {
    if (sourceKind === "flow") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project" || targetKind === "goal";
    if (sourceKind === "flow_goal") return targetKind === "flow" || targetKind === "flow_goal";
    if (sourceKind === "flow_task") return targetKind === "flow" || targetKind === "flow_goal" || targetKind === "flow_task";
    return false; // a real node can never drop onto a flow or flow item
  }

  // A Tag is a label, and the one thing you hang on a label is a note about it. The backend has
  // always said so — `infos.parent_type` names `tag` — and so does `ALLOWED_CHILD_KINDS.tag`; this
  // arm used to refuse everything, which made the two rules in this file contradict each other.
  // It still sits above the `info` arms, so every other kind is refused before they are reached.
  if (targetKind === "tag") return sourceKind === "info";
  if (targetKind === "info") return sourceKind === "info";
  if (sourceKind === "info") return true;
  // A commitment lives anywhere a task can, plus inside another commitment; it holds only
  // tasks and other commitments. (Tag and info targets were already refused above.)
  if (targetKind === "commitment") return sourceKind === "task" || sourceKind === "commitment";
  if (sourceKind === "commitment") return true;
  if (sourceKind === "project") return targetKind === "aspect" || targetKind === "project";
  if (sourceKind === "domain") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "tag") return targetKind === "aspect" || targetKind === "domain" || targetKind === "project";
  if (sourceKind === "goal") {
    return targetKind === "aspect" || targetKind === "domain" || targetKind === "project" || targetKind === "goal";
  }
  // task: valid under aspect, domain, project, goal, or task. Stated rather than defaulted to, and
  // the function ends in `false`: a kind added to `NodeKind` later is refused until someone teaches
  // this rule about it, because "permitted unless named" is how a folded run came to take children.
  if (sourceKind === "task") {
    return targetKind === "aspect" || targetKind === "domain" || targetKind === "project" ||
      targetKind === "goal" || targetKind === "task";
  }
  return false;
}

/**
 * The node kinds a Shift+initial chord creates directly under the selection, bypassing Tab's
 * inherit-the-parent default. Deliberately the seven *named* kinds a user reaches for; flow items
 * are left out because they are spawned by Tab from inside their flow. Two of the seven open an
 * editor rather than a blank row — see `onCreateTypedChild`.
 */
export const TYPED_CHILD_KINDS = ["domain", "project", "goal", "task", "commitment", "info", "flow"] as const;

/** One of the kinds a Shift+initial chord can create. */
export type TypedChildKind = (typeof TYPED_CHILD_KINDS)[number];

/**
 * Every kind that can hold a child, in the order a refusal message should read them out. The flow
 * kinds are on the end so a flow item's answer is a list rather than an empty one: a refused paste
 * has to be able to say where a flow item *does* go, and that is inside its Flow.
 */
const PARENT_CANDIDATES: readonly NodeKind[] = [
  "aspect", "domain", "project", "goal", "task", "commitment", "info", "tag",
  "flow", "flow_goal", "flow_task",
];

/**
 * The kinds that may hold `childKind` as a direct child — the parenting rule, stated positively,
 * for a refusal message that says where the thing *can* go rather than only that it can't go here.
 * Derived from `isValidDropTarget` so creating and reparenting can never disagree about the rule.
 */
export function validParentKinds(childKind: NodeKind): NodeKind[] {
  return PARENT_CANDIDATES.filter((parentKind) => isValidDropTarget(childKind, parentKind));
}

/**
 * What a node is, as far as holding a child goes — the thing its *kind* cannot tell you.
 *
 * `row`        — an ordinary node with a database row a child's parent link can point at.
 * `occurrence` — a virtual Habit occurrence. It has no row, but it can hold children of its own
 *                through the attachment path (`create_habit_instance_child`), which writes the
 *                child and hangs it on that one iteration in a single call.
 * `drawing`    — something drawn rather than stored, and nobody's parent: the synthetic root,
 *                a folded run of Habit history, and any other virtual node.
 */
type ParentCapacity = "row" | "occurrence" | "drawing";

/** Which of the three `node` is. Ordered deepest fact first: a folded run is virtual too. */
function parentCapacity(node: MindmapNode): ParentCapacity {
  // A folded run of passed iterations — a tally and a span, standing in for many nodes at once.
  if (node.habitGroup !== undefined) return "drawing";
  if (node.habitItem !== undefined) return "occurrence";
  // The synthetic root and any other virtual node: nothing a parent link could point at.
  if (node.rowId === undefined) return "drawing";
  return "row";
}

/**
 * Whether a **new** node of `childKind` can be created directly under `node`.
 *
 * {@link isValidDropTarget} answers the question about kinds; this asks it about the node, which
 * is the only form of the question a gesture actually has. A kind cannot tell a real row from a
 * drawing of one — the synthetic root, a folded run of Habit history and a virtual occurrence all
 * wear a kind that would otherwise say yes — so every gesture that asked the kind alone had to
 * remember virtuality separately, and each one that forgot failed a different way.
 *
 * Virtuality is not one answer. An **occurrence** holds children of its own, attached to that one
 * iteration; everything else that is drawn rather than stored holds nothing at all.
 */
export function canParentNewChild(node: MindmapNode, childKind: NodeKind): boolean {
  switch (parentCapacity(node)) {
    case "drawing":
      return false;
    case "occurrence":
      // An occurrence's children are ordinary nodes, written and hung on that one iteration by the
      // attachment path. A Flow or a flow item is not one of those: it belongs to the Habit's
      // template, which is the very thing the occurrence is a repetition of. Everything else its
      // drawn kind would take, it takes — so `Shift+G` under a Task occurrence is refused exactly
      // as it is under a Task, and the four kinds left are the four the attachment path writes.
      return !isFlowKind(childKind) && isValidDropTarget(childKind, node.kind);
    case "row":
      return isValidDropTarget(childKind, node.kind);
  }
}

/**
 * Whether an **existing** node of `childKind` can be re-parented under `node` — a drag, or a paste.
 *
 * Deliberately stricter than {@link canParentNewChild} on exactly one node: a Habit **occurrence**
 * can be *given* a new child but cannot adopt an existing one. Attaching writes the child and the
 * link together; a move only re-points a row's `parent_id`, and an occurrence has no id for one to
 * point at. Two predicates rather than one with a flag, because the difference is a real one about
 * the two writes, not a mode of the same question.
 */
export function canAdoptExistingChild(node: MindmapNode, childKind: NodeKind): boolean {
  return canAdoptChildren(node) && isValidDropTarget(childKind, node.kind);
}

/**
 * Whether `node` has a database row for an existing child's parent link to point at.
 *
 * The question a paste and a drag ask of their **destination** before they ask anything about what
 * is being moved. A folded run of Habit history, a virtual occurrence and the synthetic root refuse
 * every kind for the same one reason, and saying that reason once is not the same sentence as
 * telling the user, of each node on the clipboard in turn, that it cannot sit under a Task.
 */
export function canAdoptChildren(node: MindmapNode): boolean {
  return parentCapacity(node) === "row";
}

/**
 * Whether **any** new child can be created under `node` at all.
 *
 * The question `Tab` asks, and the only form it can ask it in: `Tab` names no kind — the parent
 * decides what its child is — so there is nothing to put to {@link canParentNewChild}. What
 * answers no is anything drawn rather than stored: a folded run of Habit history, the synthetic
 * root, and any other virtual node.
 *
 * A **Tag** answers yes, because it holds an Info note — but `Tab` is still refused on one, in the
 * gesture rather than here: `Tab` creates the parent's *default* child, which for a label would be
 * a Domain, and the one kind a Tag does hold has a chord of its own (`Shift+I`).
 */
export function canParentAnyNewChild(node: MindmapNode): boolean {
  return ALL_NODE_KINDS.some((kind) => canParentNewChild(node, kind));
}

/**
 * Whether a **new Task** can be created under `node` — {@link canParentNewChild} for the kind the
 * List View creates, which is the only kind it creates.
 */
export function canParentNewTask(node: MindmapNode): boolean {
  return canParentNewChild(node, "task");
}

/**
 * Whether `node` has an editor to open at all.
 *
 * Three kinds of node have none. An **Aspect** is fixed — six built-in roots, not user-managed. A
 * folded run of Habit history is a **drawing**, with nothing behind it to edit. And a **virtual
 * Habit instance** is rendered from its template rather than stored: its window is derived from the
 * flow's Duration and the item's Cycle, and a save would compute a database id from a `-virtual`
 * id tail and write nothing.
 *
 * It lives here, beside the other node-aware predicates, because it was previously encoded twice —
 * once as a silent `return` in the gesture and once as a `null` branch in the modal fan-out. Two
 * encodings of one fact is how the Steps View shipped a card that set an editor open, rendered no
 * modal, and left the keyboard captured with nothing on screen to release it.
 */
export function hasNodeEditor(node: MindmapNode): boolean {
  if (node.kind === "aspect" || node.kind === "habit_group") return false;
  return node.habitItem === undefined;
}
