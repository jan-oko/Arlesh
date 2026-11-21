import type { Chord, HotkeyLabelKey } from "./chord";
import { matchesChord } from "./chord";
import type { ReviewVerdict } from "@/api/expectations";

/** One key of a review's keyboard: the verdict it selects, and its cheat-sheet row. */
export interface ReviewKey {
  verdict: ReviewVerdict;
  chord: Chord;
  labelKey: HotkeyLabelKey;
}

/**
 * The review answer's own keys (ADR 0021): they **select** a verdict, nothing more, and act while
 * focus is anywhere in a review item (its note or its controls), never in a staged one.
 *
 * Not bindings in the registry: like the Scope Picker's they act on the focused component, not on a
 * view. The review marks itself `data-owns-keys` with these codes, so a view's own binding on the
 * same chord stands aside while focus is inside it, and it dispatches from this table, which the
 * cheat-sheet lists, so the two cannot disagree.
 */
export const REVIEW_KEYS: readonly ReviewKey[] = [
  { verdict: "approved", chord: { code: "KeyY", alt: true }, labelKey: "reviewApproveKey" },
  { verdict: "changes_requested", chord: { code: "KeyN", alt: true }, labelKey: "reviewRequestChangesKey" },
];

/** The codes the review owns, as `data-owns-keys` lists them. */
export const REVIEW_OWNED_CODES: string = REVIEW_KEYS.map((key) => key.chord.code).join(" ");

/** The verdict a key press selects, or `null` when it is none of the review's keys. */
export function verdictForKey(event: KeyboardEvent): ReviewVerdict | null {
  return REVIEW_KEYS.find((key) => matchesChord(event, key.chord))?.verdict ?? null;
}

/** The chord that selects `verdict`, for a control's tooltip and `aria-keyshortcuts`. */
export function chordFor(verdict: ReviewVerdict): Chord | null {
  return REVIEW_KEYS.find((key) => key.verdict === verdict)?.chord ?? null;
}
