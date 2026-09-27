import type { MindmapNode, NodeKind } from "./tree-layout";
import { isOccurrence } from "@/utils/node-identity";
import { ALL_NODE_KINDS } from "./tree-layout";

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
  // A ring not closed yet: waiting on something, not an action.
  expectation: "◌",
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
  expectation: "Expectation",
  tag: "Tag",
  info: "Info",
  flow: "Flow",
  flow_goal: "Goal",
  flow_task: "Task",
  habit_group: "Habit history",
};

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
 *   commitment                 → task, commitment, expectation, info children
 *   expectation                → info children only (and it hangs wherever a task can)
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
  // always said so — `infos.parent_type` names `tag`. It sits above the `info` arms, so every other
  // kind is refused before they are reached.
  if (targetKind === "tag") return sourceKind === "info";
  if (targetKind === "info") return sourceKind === "info";
  // A wait holds notes about it and nothing else.
  if (targetKind === "expectation") return sourceKind === "info";
  if (sourceKind === "info") return true;
  // A commitment lives anywhere a task can, plus inside another commitment; it holds only
  // tasks, other commitments and waits. (Tag and info targets were already refused above.)
  if (targetKind === "commitment") {
    return sourceKind === "task" || sourceKind === "commitment" || sourceKind === "expectation";
  }
  if (sourceKind === "commitment") return true;
  // A wait lives anywhere a Task can: under a domain-table kind, a Goal, a Task — or a Commitment,
  // answered just above.
  if (sourceKind === "expectation") {
    return targetKind === "aspect" || targetKind === "domain" || targetKind === "project" ||
      targetKind === "goal" || targetKind === "task";
  }
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
 * The kinds a Shift+initial chord creates directly under the selection. Deliberately the *named*
 * kinds a user reaches for; flow items are left out because they are spawned by Tab from inside
 * their flow. Three of them open an editor rather than a blank row — see `onCreateTypedChild`.
 *
 * `habit` is the one entry that is not a node kind of its own: a Habit is a Flow with its
 * Recurrence switched on, so it is created as a Flow and parented by a Flow's rules
 * ({@link typedChildNodeKind}).
 */
export const TYPED_CHILD_KINDS = ["domain", "project", "goal", "task", "commitment", "expectation", "info", "flow", "habit"] as const;

/** One of the kinds a Shift+initial chord can create. */
export type TypedChildKind = (typeof TYPED_CHILD_KINDS)[number];

/** The node kind a typed chord's child is stored as — a Habit is a Flow, every other one itself. */
export function typedChildNodeKind(kind: TypedChildKind): NodeKind {
  return kind === "habit" ? "flow" : kind;
}

/**
 * Every kind that can hold a child, in the order a refusal message should read them out. The flow
 * kinds are on the end so a flow item's answer is a list rather than an empty one: a refused paste
 * has to be able to say where a flow item *does* go, and that is inside its Flow.
 */
const PARENT_CANDIDATES: readonly NodeKind[] = [
  "aspect", "domain", "project", "goal", "task", "commitment", "expectation", "info", "tag",
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
 * `occurrence` — a Habit occurrence: a derived row (ADR 0008). It holds children of its own —
 *                a child created or moved under it is hung on that one iteration — but not the
 *                Habit's own template kinds, and nothing is copied onto it.
 * `drawing`    — something drawn rather than stored, and nobody's parent: the synthetic root,
 *                a folded run of Habit history, and any other virtual node.
 */
type ParentCapacity = "row" | "occurrence" | "drawing";

/** Which of the three `node` is. Ordered deepest fact first: a folded run is virtual too. */
function parentCapacity(node: MindmapNode): ParentCapacity {
  // A folded run of passed iterations — a tally and a span, standing in for many nodes at once.
  if (node.habitGroup !== undefined) return "drawing";
  if (isOccurrence(node)) return "occurrence";
  // The synthetic root and any other virtual node: nothing a parent link could point at.
  if (node.rowId === undefined) return "drawing";
  return "row";
}

/**
 * Whether a **new** node of `childKind` can be created directly under `node`.
 *
 * {@link isValidDropTarget} answers the question about kinds; this asks it about the node, which
 * is the only form of the question a gesture actually has. A kind cannot tell a real row from a
 * drawing of one — the synthetic root and a folded run of Habit history wear a kind that would
 * otherwise say yes — so every gesture that asked the kind alone had to
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
      // An occurrence's children are ordinary nodes, hung on that one iteration. A Flow or a flow
      // item is not one of those: it belongs to the Habit's template, which is the very thing the
      // occurrence is a repetition of. Everything else its kind would take, it takes — so
      // `Shift+G` under a Task occurrence is refused exactly as it is under a Task.
      return !isFlowKind(childKind) && isValidDropTarget(childKind, node.kind);
    case "row":
      return isValidDropTarget(childKind, node.kind);
  }
}

/**
 * Whether an **existing** node of `childKind` can be re-parented under `node` — a drag, or a paste.
 *
 * The same answer {@link canParentNewChild} gives: a node moved onto a Habit occurrence is hung on
 * that one iteration, exactly as one created there is.
 */
export function canAdoptExistingChild(node: MindmapNode, childKind: NodeKind): boolean {
  return canAdoptChildren(node) && canParentNewChild(node, childKind);
}

/**
 * Whether `node` has a row for an existing child's parent link to point at — a stored row, or a
 * Habit occurrence.
 *
 * The question a paste and a drag ask of their **destination** before they ask anything about what
 * is being moved. A folded run of Habit history and the synthetic root refuse every kind for the
 * same one reason, and saying that reason once is not the same sentence as telling the user, of
 * each node on the clipboard in turn, that it cannot sit under a Task.
 */
export function canAdoptChildren(node: MindmapNode): boolean {
  return parentCapacity(node) !== "drawing";
}

/**
 * Whether **any** new child can be created under `node` at all.
 *
 * The question the Steps View asks of an empty Step before it offers a first child. What answers
 * no is anything drawn rather than stored: a folded run of Habit history, the synthetic root, and
 * any other virtual node.
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
 * Two kinds of node have none. An **Aspect** is fixed — six built-in roots, not user-managed. A
 * folded run of Habit history is a **drawing**, with nothing behind it to edit. A Habit occurrence
 * has the editor of its kind (ADR 0008); what it saves lands on that occurrence alone.
 *
 * It lives here, beside the other node-aware predicates, because it was previously encoded twice —
 * once as a silent `return` in the gesture and once as a `null` branch in the modal fan-out. Two
 * encodings of one fact is how the Steps View shipped a card that set an editor open, rendered no
 * modal, and left the keyboard captured with nothing on screen to release it.
 */
export function hasNodeEditor(node: MindmapNode): boolean {
  return node.kind !== "aspect" && node.kind !== "habit_group";
}
