import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { TYPED_CHILD_KINDS, canAdoptChildren, canParentAnyNewChild, canParentNewChild } from "@/utils/node-meta";
import type { TypedChildKind } from "@/utils/node-meta";

/**
 * What a **Steps card** says, and whether you can descend into it.
 *
 * A Steps card is a *read mode of the editor*: the fields you would open the editor to see, laid
 * out to be read. That is the whole difference between this view and the other two — a Mindmap node
 * is a title, a glyph and a badge row, and a List row adds tag pills. None of it costs a fetch:
 * `MindmapNode` already carries what the editors edit, resolved on load.
 */

/**
 * One field a card can spell out in words, as opposed to a badge glyph.
 *
 * **A card never repeats what the status row or the icon already says.** The two of them are not
 * decoration — the icon encodes a Task's and a Goal's status, a Commitment's Verdict and whether a
 * Flow recurs, and the badge row carries every boolean flag. So the fields that were `Backlog: Yes`,
 * `Agentic: Yes`, `Asynchronous: Yes`, `Status`, `Verdict` and `Recurrence` are gone: each one was
 * a second copy of something already on the card, in a view whose whole scarcity is vertical space.
 *
 * What stays is what those two cannot say. A badge tells you a Task **has** a Time Scope; only a
 * field tells you it is *this week*. That is the line — a boolean in the row is a duplicate, the
 * value behind it is not.
 */
export type StepFieldKind =
  | "status"
  | "timeScope"
  | "onScopeExit"
  | "plan"
  | "verdictWindow"
  | "checkEvery"
  | "blockedBy"
  | "details"
  | "knowledgeBase"
  | "instanceType"
  | "private"
  | "beadsId"
  | "tags";

/**
 * The fields **every** kind can carry, read after the kind's own. They are last because they are
 * the incidental ones: what a node is blocked by matters on a Task and on a Goal alike, but it is
 * not what tells a Task from a Goal.
 */
const SHARED_FIELDS: readonly StepFieldKind[] = ["blockedBy", "tags", "beadsId", "private"];

/**
 * The fields each kind can carry, in reading order.
 *
 * **Derived from the kind, as the editors are** — rather than rendering everything and hiding the
 * blanks. A Commitment's Verdict Window is meaningless on a Domain and a Task's Backlog is
 * meaningless on a Goal, and a card that listed them greyed out would be saying they could apply.
 */
function fieldsForKind(node: MindmapNode): readonly StepFieldKind[] {
  switch (node.kind) {
    // No Status: the Task and Goal glyphs already draw it, and draw blocked-ness with it.
    case "task":
    case "goal":
      return ["timeScope", "plan", "onScopeExit"];
    // No Verdict: the Commitment shield is the verdict. The window it is answerable within is not
    // drawn anywhere, so that stays.
    case "commitment":
      return ["verdictWindow", "timeScope", "plan"];
    // No Status: the ring is the status — open while pending, solid once released. The check-by
    // is drawn nowhere else.
    case "expectation":
      return ["timeScope", "checkEvery"];
    case "info":
      return ["details"];
    // A Project's status *is* a field: no icon draws it, and no badge carries it.
    case "project":
      return ["status", "knowledgeBase"];
    case "aspect":
    case "domain":
    case "tag":
      return ["knowledgeBase"];
    // No Recurrence: the glyph is already the cyclical arrows for a Habit and the play mark for a
    // plain Flow, which is the same fact.
    case "flow":
      return ["instanceType"];
    case "flow_goal":
    case "flow_task":
      return ["timeScope"];
    // A folded run of Habit history is a tally and a span, not a node with fields. Steps does not
    // fold, so one should never reach a card — but "no fields" is the honest answer either way.
    case "habit_group":
      return [];
  }
}

/** Whether `node` actually carries `field`, so a card lists only what it has something to say about. */
function hasValue(node: MindmapNode, field: StepFieldKind): boolean {
  switch (field) {
    case "status":
      return node.status != null && node.status !== "";
    case "timeScope":
      return node.timeScope != null;
    case "onScopeExit":
      return node.onScopeExit != null;
    case "plan":
      return node.plan != null;
    case "verdictWindow":
      return node.verdictWindow != null;
    case "checkEvery":
      return node.checkEvery != null;
    case "blockedBy":
      return (node.blockReasons?.length ?? 0) + (node.virtualBlockers?.length ?? 0) > 0;
    case "details":
      return node.infoDetails != null && node.infoDetails !== "";
    case "knowledgeBase":
      return node.knowledgeBaseDirectory != null && node.knowledgeBaseDirectory !== "";
    case "instanceType":
      return node.flow !== undefined;
    case "private":
      return node.isPrivate === true;
    case "beadsId":
      return node.beadsId !== undefined && node.beadsId !== "";
    case "tags":
      return node.tagIds.length > 0;
  }
}

/**
 * The fields `node`'s card spells out, in reading order — its kind's own, then the shared ones,
 * each kept only where the node has a value for it.
 */
export function stepCardFields(node: MindmapNode): readonly StepFieldKind[] {
  return [...fieldsForKind(node), ...SHARED_FIELDS].filter((field) => hasValue(node, field));
}

/**
 * The two numbers a container card carries — "3 of 12".
 *
 * The first is a promise about the next Step under the active filter; the second is the fact about
 * the board, which is what makes the filter's effect visible. A card whose node the filter dropped
 * entirely has no `raw` counterpart to count, which reads as `0 of 0` rather than throwing.
 */
export interface StepChildCounts {
  matching: number;
  total: number;
}

/** {@link StepChildCounts} for one card, from its filtered node and the same node in the raw tree. */
export function stepChildCounts(
  filtered: MindmapNode,
  raw: MindmapNode | undefined,
): StepChildCounts {
  return { matching: filtered.children.length, total: raw?.children.length ?? filtered.children.length };
}

/**
 * Whether descending into `node` shows a Step, rather than being refused.
 *
 * Two ways to qualify, and a node needs one of them:
 *
 *   - **It already holds something.** A container with children always opens, whatever it is.
 *   - **It could be given something.** A leaf Task, an Info note and a virtual Habit occurrence all
 *     open on an *empty* Step that offers to create the first child — a leaf is not a dead end, and
 *     refusing to enter one would make "what is under this?" a question you can only ask where the
 *     answer is already yes.
 *
 * What is left is a **drawing** — a folded run of Habit history, or anything else rendered rather
 * than stored — which has no inside at all. It is refused out loud (Arlesh-zlg), through
 * {@link stepRefusalKey}.
 *
 * Every *real* node passes the second test, including a **Tag**: a tag is a label, and the one
 * thing you hang on a label is a note about it (Arlesh-71m). `stepRefusalKey`'s other answer is
 * kept for a kind that accepts nothing at all, which is a shape the model does not have today and
 * should still be refused in words if it ever does.
 *
 * `canParentAnyNewChild` is the node-aware predicate the create gestures already ask; this asks the
 * same one rather than adding a third opinion about what can hold a child.
 */
export function canDescendInto(node: MindmapNode): boolean {
  return node.children.length > 0 || canParentAnyNewChild(node);
}

/** Why {@link canDescendInto} said no — a key in the `stepsView` namespace. */
export type StepRefusalKey = "refusedHoldsNothing" | "refusedNotStored";

/**
 * The reason a descent was refused: something drawn rather than stored, or — for a kind the model
 * does not have today — a real node that can hold nothing at all.
 */
export function stepRefusalKey(node: MindmapNode): StepRefusalKey {
  return canAdoptChildren(node) ? "refusedHoldsNothing" : "refusedNotStored";
}

/**
 * What a card spends on everything that is not a field or a bullet, in pixels: the title row, the
 * kind line, the badge row, the footer, and the padding around them.
 *
 * A measured-per-card answer would be better and is not available: the grid measures the *area*,
 * and measuring forty cards to decide what to draw in them is a layout pass per card per render.
 * The rows are a fixed height by construction — every one of them is a single line that ellipses —
 * so arithmetic gets the same answer for the cost of a subtraction.
 */
const CARD_CHROME_PX = 84;

/** One field row or one bullet, in pixels. Both are single lines at `--text-sm`. */
const CARD_ROW_PX = 16;

/** How many Info bullets fit under `fieldCount` fields on a card `cardHeight` tall. */
export function bulletCapacity(cardHeight: number, fieldCount: number): number {
  const left = cardHeight - CARD_CHROME_PX - fieldCount * CARD_ROW_PX;
  return Math.max(0, Math.floor(left / CARD_ROW_PX));
}

/** The Info notes a card draws, and how many it could not. */
export interface InfoBullets {
  shown: readonly string[];
  /** How many notes the card had no room for. `0` when everything fits. */
  more: number;
}

/**
 * The first Info children of a node, as many as fit.
 *
 * **Nothing is dropped in silence.** When the notes outrun the room, the last line becomes a count
 * of what is left rather than one more note — so a card that cannot show you everything at least
 * tells you that, which is the one thing a card with three notes and room for two must not fail to
 * say. It costs a note to say it, and that is the right trade: a note you cannot see is a note you
 * do not know to go looking for.
 *
 * A note too long for its line is **truncated, never dropped** — that is the renderer's job (one
 * line, ellipsis), and the reason is the same one: a clipped note still tells you it exists and
 * roughly what it says, where a dropped one tells you nothing at all. The whole of it is one `E`
 * away.
 */
export function infoBullets(titles: readonly string[], capacity: number): InfoBullets {
  if (capacity <= 0) return { shown: [], more: titles.length };
  if (titles.length <= capacity) return { shown: titles, more: 0 };
  const shown = titles.slice(0, capacity - 1);
  return { shown, more: titles.length - shown.length };
}

/** The titles of `node`'s direct Info children, in the order they are drawn. */
export function infoChildTitles(node: MindmapNode): string[] {
  return node.children.filter((child) => child.kind === "info").map((child) => child.title);
}

/**
 * Whether a card draws a glyph for `kind`, and so reserves the slot for one. An Aspect has none: on
 * the Mindmap it is a coloured block, and on a card it is known by its name and by sitting at the
 * root. A slot with nothing in it is an empty gap before the title.
 */
export function cardDrawsGlyph(kind: NodeKind): boolean {
  return kind !== "aspect";
}

/**
 * The kinds whose glyph is **borrowed** from another kind: a Flow's template Goal and Task are drawn
 * with the Goal and Task glyphs, so on a card only the words tell a template from the real thing.
 */
const KINDS_SHARING_A_GLYPH: ReadonlySet<NodeKind> = new Set<NodeKind>(["flow_goal", "flow_task"]);

/**
 * Whether a card writes its kind out under the title. Only where the glyph cannot say it — a Flow's
 * template Goal and Task. Everywhere else the line was the glyph again in capitals; and an Aspect,
 * which has no glyph, is recognisable without either.
 */
export function cardWritesKind(kind: NodeKind): boolean {
  return KINDS_SHARING_A_GLYPH.has(kind);
}

/**
 * The kinds the Step's "+" offers: every kind a `Shift`+initial chord can create that `node` can
 * actually hold, asked of the node as the chords' own refusal asks it — so the menu never offers
 * something the create would then refuse.
 */
export function creatableKinds(node: MindmapNode): readonly TypedChildKind[] {
  return TYPED_CHILD_KINDS.filter((kind) => canParentNewChild(node, kind));
}
