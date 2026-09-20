/**
 * The Verdict vocabulary, kept apart from the Commitment IPC calls that use it.
 *
 * It lives here rather than in `commitments.ts` because the filter utilities need the three
 * values and nothing else: importing them from the IPC module dragged `./gesture`, and with it
 * Tauri's `invoke`, into every module that merely wanted to name a Verdict — including the tab
 * store the test setup loads, which then pinned the real `@tauri-apps/api/core` in place before
 * any suite could mock it. A vocabulary has no reason to depend on the transport.
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
