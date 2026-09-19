import type { Verdict } from "@/api/commitments";
import { VERDICT } from "@/api/commitments";

/**
 * The four states a Commitment's glyph draws, in the order a commitment passes through them.
 *
 * `expired` is not a fourth Verdict — the Verdict stays `unresolved` for good. It is the pairing
 * of an unresolved Verdict with an effective Archival of Archived, which for a Commitment can only
 * mean one thing: the Verdict Window ran out before anything was recorded, and the chance to say
 * has gone.
 */
export const COMMITMENT_GLYPH = {
  LIVE: "live",
  KEPT: "kept",
  BROKEN: "broken",
  EXPIRED: "expired",
} as const;

/** One of the four states in {@link COMMITMENT_GLYPH}. */
export type CommitmentGlyphState = typeof COMMITMENT_GLYPH[keyof typeof COMMITMENT_GLYPH];

/**
 * Which glyph a Commitment draws, from its recorded Verdict and its effective Archival.
 *
 * Both inputs are read off the node exactly as the rest of the app reads them — the Verdict from
 * the commitment's own row and the Archival from the backend's lifecycle derivation, the same one
 * that dims the node and raises its archive badge. Nothing here recomputes when a Verdict Window
 * runs out; it only says what the two together look like.
 *
 * A *judged* commitment keeps its verdict glyph once it archives: kept is kept whether or not its
 * window has since closed, and the record of having broken something does not fade into "never
 * answered".
 */
export function commitmentGlyphState(
  verdict: Verdict | undefined,
  isArchived: boolean,
): CommitmentGlyphState {
  if (verdict === VERDICT.KEPT) return COMMITMENT_GLYPH.KEPT;
  if (verdict === VERDICT.BROKEN) return COMMITMENT_GLYPH.BROKEN;
  return isArchived ? COMMITMENT_GLYPH.EXPIRED : COMMITMENT_GLYPH.LIVE;
}
