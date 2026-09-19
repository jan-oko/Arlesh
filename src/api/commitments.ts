import { invoke } from "@tauri-apps/api/core";
import type { TimeScope, DurationSpec } from "@/api/time-scope";

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

export interface Commitment {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  verdict: Verdict;
  // Null inherits the nearest scoped ancestor's. Unlike every other kind, the *effective* window
  // may not be absent: a commitment with no window anywhere above it is refused at write time.
  time_scope: TimeScope | null;
  // The Verdict Window: how long past the end of its window this stays answerable, as a count of
  // any scope kind. Absent inherits the nearest ancestor Commitment's; nothing above setting one
  // means it never expires.
  verdict_window?: DurationSpec;
  tag_ids: number[];
  position: number;
  is_private: boolean;
  // The bd issue this commitment is tracked as. Written only by the MCP server.
  beads_id?: string;
}

export interface CreateCommitmentRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  verdict?: Verdict;
  time_scope?: TimeScope;
  verdict_window?: DurationSpec;
}

export interface UpdateCommitmentRequest {
  title?: string;
  // Recording, changing and clearing a verdict are all this one field — a misclick is undone by
  // the same call that made it.
  verdict?: Verdict;
  // Absent = leave unchanged, null = clear, value = set.
  time_scope?: TimeScope | null;
  // Absent = leave unchanged, null = go back to inheriting, value = set.
  verdict_window?: DurationSpec | null;
  parent_type?: string;
  parent_id?: number;
  position?: number;
  is_private?: boolean;
}

export async function listCommitments(): Promise<Commitment[]> {
  return invoke<Commitment[]>("list_commitments");
}

export async function getCommitment(id: number): Promise<Commitment> {
  return invoke<Commitment>("get_commitment", { id });
}

/**
 * Creates a commitment.
 *
 * Refused when it would have no effective Time Scope — neither its own nor a scoped ancestor's.
 * That is the rule unique to this kind: a rule held over no window can never come due.
 */
export async function createCommitment(request: CreateCommitmentRequest): Promise<Commitment> {
  return invoke<Commitment>("create_commitment", { request });
}

export async function updateCommitment(
  id: number,
  request: UpdateCommitmentRequest,
): Promise<Commitment> {
  return invoke<Commitment>("update_commitment", { id, request });
}

export async function deleteCommitment(id: number): Promise<void> {
  return invoke<void>("delete_commitment", { id });
}

export async function addTagToCommitment(commitmentId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_commitment", { commitmentId, tagId });
}

export async function removeTagFromCommitment(commitmentId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_commitment", { commitmentId, tagId });
}

/**
 * The verdict a control should write when it is pressed on a commitment currently reading
 * `current`.
 *
 * The tick and the cross are two explicit, equal choices, and each one toggles: pressing the tick
 * on a kept commitment clears it, pressing the cross on a broken one clears it. What neither
 * control ever does is move straight from one verdict to the other — reaching Broken is always
 * the cross, never a repeat of the tick.
 */
export function verdictAfterPressing(pressed: Exclude<Verdict, "unresolved">, current: Verdict): Verdict {
  return current === pressed ? VERDICT.UNRESOLVED : pressed;
}

/**
 * The verdict Enter advances to (Unresolved → Kept → Broken → Unresolved).
 *
 * One key walks the whole answer, so a commitment can be judged, corrected and un-judged without
 * leaving the row. Kept leads because it is the answer given most often; Broken sitting one press
 * further along is not the only way to reach it, since `X` writes Broken directly from any state.
 */
export const NEXT_VERDICT: Record<Verdict, Verdict> = {
  unresolved: "kept",
  kept: "broken",
  broken: "unresolved",
};
