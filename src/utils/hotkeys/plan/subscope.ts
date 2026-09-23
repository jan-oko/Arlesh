import type { Binding } from "@/utils/hotkeys/chord";
import { MAX_SUBSCOPE_KEYS, SUBSCOPE_LETTERS } from "@/utils/plan-subscope-keys";
import type { PlanSelectionContext } from "./selection";

/** What planning the selection into one bucket of the split acts on. */
export interface PlanSubscopeContext extends PlanSelectionContext {
  /**
   * Whether `key` names a bucket of the pass on screen right now — a digit's position, or a
   * letter's mnemonic. The guard, so a key that names nothing falls through instead of eating the
   * event: with the split off, or on a scope with no parts, none of these keys is bound at all.
   */
  hasSubscopeKey: (key: string) => boolean;
  /** Plans every selected row into the bucket `key` names. */
  onPlanIntoSubscope: (key: string) => void;
}

/**
 * The keys that put the selection into a **subscope** of the scope being filled.
 *
 * With the planned pane split there is no "plan into this scope" any more: the buckets are its
 * parts, and planning into the whole while looking at the parts is the move that used to leave work
 * in a catch-all nobody wanted. So a row reaches a bucket three ways — dragged onto it, sent by its
 * **number**, or sent by its **letter** where one letter names it and nothing else. All three act
 * on the whole selection, and all three write one Gesture.
 *
 * The letters are declared as a fixed table and *guarded* rather than built per scope, because a
 * binding table is read once and a scope changes every time you press `]`. `hasSubscopeKey` is what
 * makes the two agree: the same assignment that draws the hint on a bucket's heading decides
 * whether the key fires, so a key that is drawn always works and a key that is not is not bound.
 */
const digits = Array.from({ length: MAX_SUBSCOPE_KEYS }, (_unused, index) => String(index + 1));

function subscopeBinding(key: string, code: string, first: boolean): Binding<PlanSubscopeContext> {
  return {
    id: `planView.subscope.${key}`,
    section: "planView",
    chord: { code },
    labelKey: key === "1" ? "planSubscopeNumber" : "planSubscopeLetter",
    allowRepeat: false,
    // Only the first of each family is on the cheat-sheet: seven digit rows and ten letter rows
    // saying the same sentence would bury the table they are listed in.
    hidden: !first,
    when: (c) => c.selectedTaskIds.length > 0 && c.hasSubscopeKey(key),
    run: (c) => c.onPlanIntoSubscope(key),
  };
}

export const PLAN_SUBSCOPE_BINDINGS: readonly Binding<PlanSubscopeContext>[] = [
  ...digits.map((digit, index) => subscopeBinding(digit, `Digit${digit}`, index === 0)),
  ...SUBSCOPE_LETTERS.map((letter, index) => subscopeBinding(letter, `Key${letter}`, index === 0)),
];
