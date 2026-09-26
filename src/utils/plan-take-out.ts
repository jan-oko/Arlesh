// Where the Plan View sends work it takes back out of the scope being filled. Pure, so the rule can
// be read — and tested — apart from the writes that carry it out.

/**
 * What taking work out of the planned pane does to its Plan: moves it to a scope, or clears it.
 *
 * Generic over what a scope is to the caller, so the rule stays a statement about *which* scope and
 * the caller keeps whatever it needs to write and word it (a key, a window, a label).
 */
export type TakeOutTarget<S> = { kind: "plan"; scope: S } | { kind: "clear" };

/**
 * The scope work taken out of `filled` lands on: **one rung up, to the scope whose work the
 * candidates side shows**, so what you take out stays in front of you rather than vanishing.
 *
 * - **Split by subscope** — the work sat in a bucket, a *part* of the scope. Taking it out of the
 *   part plans it to the scope itself, which no bucket holds, and that work is on the candidates
 *   side while the pane is split.
 * - **Not split** — the work sat in the scope. Taking it out plans it to the **parent**, the one
 *   rung above that the candidates pane reads as "planned to the parent scope".
 * - **Not split, and no parent** — a Season, the top of the ladder. There is no rung to move it
 *   to, so the Plan is cleared, and the work comes back as unplanned relevant work.
 */
export function takeOutTarget<S>(split: boolean, filled: S, parent: S | null): TakeOutTarget<S> {
  if (split) return { kind: "plan", scope: filled };
  if (parent !== null) return { kind: "plan", scope: parent };
  return { kind: "clear" };
}
