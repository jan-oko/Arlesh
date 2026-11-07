import { invoke } from "./gesture";
import type { Commitment } from "@/api/commitments";
import type { RowId } from "@/api/node-id";
import type { Task } from "@/api/tasks";

/**
 * The gestures the backend decides (`src-tauri/src/commands/gestures.rs`). The frontend sends what
 * the user did and renders — and words — what came back; what a press means is decided once, in
 * `tasks::rules::gestures`.
 */

/** A status gesture: a click on the glyph or `Enter` (`advance`), or `Alt+Enter` (`alt`). */
export type StatusStep = "advance" | "alt";

/** Why a status gesture wrote nothing. */
export type StatusRefusal = "compound" | "alt_enter_agentic_not_doing";

/** How a status write took a Task out of the Backlog. */
export type BacklogCleared = "by_started" | "by_start";

/** What a status gesture did. */
export type StatusStepOutcome =
  | { outcome: "written"; task: Task; backlog_cleared: BacklogCleared | null }
  | { outcome: "refused"; reason: StatusRefusal };

/** A verdict gesture: the cycle key, or the Kept or Broken control. */
export type VerdictPress = "cycle" | "kept" | "broken";

/**
 * Applies a status gesture to a Task. Marking a Habit occurrence done over unfinished children is
 * refused for confirmation unless `confirmed`, as an edit is.
 */
export async function stepTaskStatus(id: RowId, step: StatusStep, confirmed?: boolean): Promise<StatusStepOutcome> {
  return invoke<StatusStepOutcome>("step_task_status", { id, step, confirmed });
}

/** The Agentic key: writes the opposite of what the Task reads as, as its own flag. */
export async function toggleTaskAgentic(id: RowId): Promise<Task> {
  return invoke<Task>("toggle_task_agentic", { id });
}

/** A verdict gesture on a Commitment. */
export async function pressCommitmentVerdict(id: RowId, press: VerdictPress): Promise<Commitment> {
  return invoke<Commitment>("press_commitment_verdict", { id, press });
}
