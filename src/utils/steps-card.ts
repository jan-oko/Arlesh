import type { MindmapNode } from "@/utils/tree-layout";
import { canAdoptChildren, canParentAnyNewChild } from "@/utils/node-meta";

/**
 * What a **Steps card** says, and whether you can descend into it.
 *
 * A Steps card is a *read mode of the editor*: the fields you would open the editor to see, laid
 * out to be read. That is the whole difference between this view and the other two — a Mindmap node
 * is a title, a glyph and a badge row, and a List row adds tag pills. None of it costs a fetch:
 * `MindmapNode` already carries what the editors edit, resolved on load.
 */

/** One field a card can spell out in words, as opposed to a badge glyph. */
export type StepFieldKind =
  | "status"
  | "timeScope"
  | "onScopeExit"
  | "plan"
  | "verdict"
  | "verdictWindow"
  | "blockedBy"
  | "details"
  | "knowledgeBase"
  | "instanceType"
  | "recurrence"
  | "backlog"
  | "agentic"
  | "asynchronous"
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
    case "task":
      return ["status", "timeScope", "plan", "onScopeExit", "backlog", "agentic", "asynchronous"];
    case "goal":
      return ["status", "timeScope", "plan", "onScopeExit"];
    case "commitment":
      return ["verdict", "verdictWindow", "timeScope", "plan"];
    case "info":
      return ["details"];
    case "project":
      return ["status", "knowledgeBase"];
    case "aspect":
    case "domain":
    case "tag":
      return ["knowledgeBase"];
    case "flow":
      return ["instanceType", "recurrence"];
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
    case "verdict":
      return node.verdict !== undefined;
    case "verdictWindow":
      return node.verdictWindow != null;
    case "blockedBy":
      return (node.blockReasons?.length ?? 0) + (node.virtualBlockers?.length ?? 0) > 0;
    case "details":
      return node.infoDetails != null && node.infoDetails !== "";
    case "knowledgeBase":
      return node.knowledgeBaseDirectory != null && node.knowledgeBaseDirectory !== "";
    case "instanceType":
      return node.flow !== undefined;
    case "recurrence":
      return node.flow?.isHabit === true;
    case "backlog":
      return node.backlogged === true;
    case "agentic":
      return node.agentic != null || node.inheritedAgentic === true;
    case "asynchronous":
      return node.asynchronous === true;
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
 * What is left is genuinely nothing: a childless **Tag**, which is a label rather than a container,
 * and a childless **drawing** — a folded run of Habit history, or anything else rendered rather than
 * stored. Both are refused out loud (Arlesh-zlg), through {@link stepRefusalKey}.
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
 * The reason a descent was refused, as the two genuinely different ones: a real node that holds
 * nothing, and something drawn rather than stored, which has no inside at all.
 */
export function stepRefusalKey(node: MindmapNode): StepRefusalKey {
  return canAdoptChildren(node) ? "refusedHoldsNothing" : "refusedNotStored";
}
