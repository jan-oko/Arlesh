/**
 * The Verdict vocabulary, kept apart from the Commitment IPC calls that use it.
 *
 * It lives here rather than in `commitments.ts` because the filter utilities need the three
 * values and nothing else: importing them from the IPC module dragged `./gesture`, and with it
 * Tauri's `invoke`, into every module that merely wanted to name a Verdict — including the tab
 * store the test setup loads, which then pinned the real `@tauri-apps/api/core` in place before
 * any suite could mock it. A vocabulary has no reason to depend on the transport.
 *
 * `commitments.ts` re-exported these four for a while, so the old path kept compiling. It does not
 * any more, deliberately: a rule a doc comment states but the build does not check is a rule the
 * next module breaks by accident, and the re-export was the one door left open onto the failure
 * the split closed. Deleting it makes the compiler the enforcement — `import { VERDICT } from
 * "@/api/commitments"` is now a type error, caught by `npx tsc --noEmit` in the same gate a lint
 * rule would run in, naming every call site at once. That also settles why there is no
 * `no-restricted-imports` entry for this the way there is for `invoke`: `@tauri-apps/api/core`
 * really does export `invoke` and always will, so lint is the only enforcement available there,
 * whereas here the module simply stops exporting the names and a lint rule listing today's four
 * would be a second, weaker copy of a check the compiler already makes completely.
 *
 * `NEXT_VERDICT` and `verdictAfterPressing` still live in `commitments.ts` although they are pure
 * functions of a Verdict. Nothing is forced through the transport for them today — their only
 * caller outside that module's own tests is `use-commitment-verdict.ts`, which calls
 * `updateCommitment` anyway — but a module that wants only the transitions would be, so they are
 * the next candidates to move here.
 */

/**
 * Whether a Commitment was held to — the Commitment kind's answer to a Task's status.
 *
 * Never derived. Not from the window passing, not from children completing: a Task untouched at
 * window close is Missed, but a Commitment untouched may well have been Kept, so there is no
 * honest default, and "unresolved" carries real information ("you have not said") that a
 * defaulted verdict would destroy.
 */
export type Verdict = "unresolved" | "kept" | "broken";

export const VERDICT = {
  UNRESOLVED: "unresolved",
  KEPT: "kept",
  BROKEN: "broken",
} as const;

export const VERDICT_VALUES: readonly Verdict[] = [
  VERDICT.UNRESOLVED,
  VERDICT.KEPT,
  VERDICT.BROKEN,
];

/** Whether a string names a Verdict. */
export function isVerdict(value: string): value is Verdict {
  return VERDICT_VALUES.some((verdict) => verdict === value);
}
