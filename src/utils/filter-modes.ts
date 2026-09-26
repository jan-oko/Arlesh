import type { PillDimension, PillFilter, PillMode } from "@/utils/list-filter";

/**
 * Every dimension a filter value can be added to: a tag (kept in the tab's shared filter) or one of
 * the List View's own pill dimensions. Tags travel as their stored id, written as a string, so the
 * menu, the search and the chips can treat every dimension alike.
 */
export type FilterDimension = "tag" | PillDimension;

/**
 * The dimensions that ask a yes/no question of a row. Each is **one** pill in the menu — "Blocked",
 * "Agentic", "Asynchronous" — rather than a pair of values: adding it means "is X", and its Not
 * mode means "is not X". **Private** joins them only while Private Mode is on (see
 * `offeredDimensions`). A row answers exactly one of the two, so Any and All say the same thing
 * and the pill only ever flips between the two modes that differ.
 */
export type YesNoDimension = "blocked" | "agentic" | "asynchronous" | "private";

export const YES_NO_DIMENSIONS: readonly YesNoDimension[] = ["blocked", "agentic", "asynchronous", "private"];

/** The stored value that means "is X" — the only value a yes/no pill is kept under. */
export const YES_VALUE: Record<YesNoDimension, string> = {
  blocked: "blocked",
  agentic: "agentic",
  asynchronous: "asynchronous",
  private: "private",
};

/** The stored value a row reports for "is not X" — accepted from older state, never written; its label is the Not pill's wording. */
export const NO_VALUE: Record<YesNoDimension, string> = {
  blocked: "not_blocked",
  agentic: "not_agentic",
  asynchronous: "not_asynchronous",
  private: "not_private",
};

export function isYesNoDimension(dimension: FilterDimension): dimension is YesNoDimension {
  return YES_NO_DIMENSIONS.some((candidate) => candidate === dimension);
}

/** The cycle a chip or a set pill walks: All → Any → Not → All. All comes first because a plain
 * click adds a value as All. */
const NEXT_PILL_MODE: Record<PillMode, PillMode> = { all: "any", any: "exclude", exclude: "all" };

/** The modifier keys held while adding a value — a click's or a key press's. */
export interface ModifierKeys {
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The mode a value is added in, read off the keys held: **Alt** adds it as **Not** (exclude),
 * **Shift** as **Any**, and a plain click or Enter as **All**. Alt wins over Shift, since it is the
 * one that reverses the question.
 */
export function modeFromModifiers(keys: ModifierKeys): PillMode {
  if (keys.altKey) return "exclude";
  if (keys.shiftKey) return "any";
  return "all";
}

/** The mode a value is actually stored in when added in `mode`: a yes/no pill has no Any. */
export function addedMode(dimension: FilterDimension, mode: PillMode): PillMode {
  if (isYesNoDimension(dimension) && mode === "any") return "all";
  return mode;
}

/**
 * The mode a chip or a set pill moves to when clicked: **All → Any → Not → All**, and a yes/no
 * pill just flips between "is X" and "is not X".
 */
export function nextMode(dimension: FilterDimension, mode: PillMode): PillMode {
  if (isYesNoDimension(dimension)) return mode === "exclude" ? "all" : "exclude";
  return NEXT_PILL_MODE[mode];
}

/** Whether a stored yes/no pill asks for "is X" (true) or "is not X" (false). */
function asksYes(dimension: YesNoDimension, pill: PillFilter): boolean {
  const saysYes = pill.value !== NO_VALUE[dimension];
  return pill.mode === "exclude" ? !saysYes : saysYes;
}

/**
 * A yes/no dimension's pills in the one shape the menu reads: at most one pill, under the "is X"
 * value, in All ("is X") or Not ("is not X"). Older state could hold the "not X" value, or an Any,
 * or both values at once; each reads as the question it asked, and when two pills disagreed — a
 * filter nothing could pass — the first one's question is kept.
 */
export function canonicalYesNoPills(dimension: YesNoDimension, pills: readonly PillFilter[]): PillFilter[] {
  const first = pills[0];
  if (first === undefined) return [];
  return [{ value: YES_VALUE[dimension], mode: asksYes(dimension, first) ? "all" : "exclude" }];
}
