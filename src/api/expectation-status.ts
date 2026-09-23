// The Expectation vocabularies, kept apart from `expectations.ts` so that the filters and the tree
// builder can read them without importing the command wrappers — and, through them, the Tauri
// transport, which would then load ahead of a test file's own mock of it.

/** Where a wait stands: still waited on, or over. Released is what unblocks dependents. */
export const EXPECTATION_STATUS = {
  PENDING: "pending",
  RELEASED: "released",
} as const;

export type ExpectationStatus = (typeof EXPECTATION_STATUS)[keyof typeof EXPECTATION_STATUS];

/** Whether it is still in play — the usual archive, independent of the status. */
export const EXPECTATION_ARCHIVAL = {
  LIVE: "live",
  ARCHIVED: "archived",
} as const;

export type ExpectationArchival = (typeof EXPECTATION_ARCHIVAL)[keyof typeof EXPECTATION_ARCHIVAL];
