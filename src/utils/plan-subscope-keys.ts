// The keys that put the selection into one subscope of the scope being filled.
//
// With the planned pane split there is no "plan into this scope" any more — the buckets are its
// parts, and a row reaches one by drag, by number, or by a letter. This decides the last two, from
// nothing but the buckets' own names, so the answer is the same whichever kind of scope is on
// screen and no table has to be kept in step with the calendar.

/**
 * The most buckets a pass can have: the seven days of a week. A season has three months, a month
 * four to six weeks, a day six parts. Nothing reaches eight, so a single digit always suffices.
 */
export const MAX_SUBSCOPE_KEYS = 7;

/**
 * Bare letters the Plan View's own table already spends: `E` opens the editor and `F` shows the
 * board alone. A guard could tell some of them apart from a bucket key — `F` only fires with
 * nothing selected — but one key meaning one thing is worth more in a triage pass than the last two
 * mnemonics, so Friday and Evening take their numbers like everyone else.
 */
const RESERVED_LETTERS: ReadonlySet<string> = new Set(["E", "F"]);

/** How one bucket is reached from the keyboard. */
export interface SubscopeKeys {
  /** Its position in the pane, 1-based — `null` past {@link MAX_SUBSCOPE_KEYS}. */
  digit: number | null;
  /** Its initial, when that initial names it and nothing else; `null` otherwise. */
  letter: string | null;
}

/** The first letter of a label, uppercased, or `null` for a label that opens with something else. */
function initialOf(label: string): string | null {
  const match = /\p{L}/u.exec(label);
  return match === null ? null : match[0].toUpperCase();
}

/**
 * A number for every bucket and a letter for the ones a letter can name unambiguously.
 *
 * **The number is the bucket's position in the pane**, which is the calendar's own order and is
 * every bucket, always drawn — so `3` is the third week of the month you are filling for as long as
 * you are filling it. It renumbers when you step to another scope, because it names a place in what
 * is on screen and that is the whole of what it promises; a number that tried to name a *week*
 * rather than a position would have to survive a month with five of them and one with six.
 *
 * **The letter is the bucket's initial, kept only when it is unique** among the buckets drawn and is
 * not already a gesture in this view. That one rule covers every kind without a special case:
 * Monday, Wednesday and Saturday keep M, W and S while Tuesday/Thursday and Sunday fall back to
 * their numbers; Premorning, Morning, Afternoon and Noon keep theirs while Night collides with Noon
 * and Evening is spent on the editor; and every week of a month is called "W39", "W40" — all
 * starting with the same letter, all colliding, so a week number is never given a letter, which is
 * exactly what it should never have.
 */
export function assignSubscopeKeys(labels: readonly string[]): SubscopeKeys[] {
  const counts = new Map<string, number>();
  const initials = labels.map(initialOf);
  for (const initial of initials) {
    if (initial === null) continue;
    counts.set(initial, (counts.get(initial) ?? 0) + 1);
  }
  return initials.map((initial, index) => ({
    digit: index < MAX_SUBSCOPE_KEYS ? index + 1 : null,
    letter:
      initial !== null && counts.get(initial) === 1 && !RESERVED_LETTERS.has(initial) ? initial : null,
  }));
}

/**
 * Every letter that could ever become a mnemonic, so the binding table can declare a chord for each
 * and guard it on whether it names a bucket *right now*.
 *
 * Derived from the names the calendar can produce — the twelve months, the seven weekdays, the six
 * parts of a day and the four seasons — minus the reserved ones. A letter that never occurs costs a
 * dead entry in the table; a letter that occurs and is missing here is a key that silently does
 * nothing, which is why this is a list rather than a guess.
 */
export const SUBSCOPE_LETTERS: readonly string[] = [
  "A", "D", "J", "M", "N", "O", "P", "S", "T", "W",
];
