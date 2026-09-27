/**
 * What a subtree breadcrumb draws at one step of giving up room: whether the root is shown, how many
 * middle levels have folded into the `…`, and whether the current title is shown and allowed to
 * truncate.
 */
export interface CrumbFold {
  /** The first segment, the true root, is drawn rather than folded into the `…`. */
  rootShown: boolean;
  /** How many middle levels, counted from the root end, have folded into the `…`. */
  middlesFolded: number;
  /** The last segment — where you are — is drawn rather than folded into the `…`. */
  currentShown: boolean;
  /** The current title may shrink below its own width and end in an ellipsis. */
  currentTruncates: boolean;
}

/** The steps past folding the middle, in the order they are tried. */
const PAST_THE_MIDDLE: readonly Omit<CrumbFold, "middlesFolded">[] = [
  // `… › current`: the root goes before where you are does.
  { rootShown: false, currentShown: true, currentTruncates: false },
  // `root › …`: only for a current title too long to stand next to the `…` on its own.
  { rootShown: true, currentShown: false, currentTruncates: false },
  // `… › curr…`: the one step that cuts text, and it cuts one title only.
  { rootShown: false, currentShown: true, currentTruncates: true },
];

/** The last step {@link crumbFold} knows, for a chain with `middleCount` middle levels. */
export function lastFoldStep(middleCount: number): number {
  return middleCount + PAST_THE_MIDDLE.length;
}

/**
 * The breadcrumb at fold step `step`, for a chain with `middleCount` levels between root and current.
 *
 * Whole segments go before any text is cut, because a clipped title reads worse than a missing one
 * that the `…` still reaches: first the middle folds, nearest the root first, one level per step;
 * then the root; then, if the current title cannot fit even beside the `…` alone, the root comes
 * back in its place; and only when neither fits does the current title truncate — alone, never
 * together with the root. Each step is tried only because the one before it overflowed.
 */
export function crumbFold(step: number, middleCount: number): CrumbFold {
  if (!Number.isInteger(step) || step < 0 || step > lastFoldStep(middleCount)) {
    throw new RangeError("fold step outside the chain's steps");
  }
  if (step <= middleCount) {
    return { rootShown: true, middlesFolded: step, currentShown: true, currentTruncates: false };
  }
  const past = PAST_THE_MIDDLE[step - middleCount - 1];
  if (past === undefined) throw new RangeError("fold step outside the chain's steps");
  return { ...past, middlesFolded: middleCount };
}
