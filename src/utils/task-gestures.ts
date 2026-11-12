import type { StatusRefusal, StatusStep, VerdictPress } from "@/api/node-gestures";
import type { TaskStatus } from "@/api/tasks";
import type { Verdict } from "@/api/verdict";
import { altStep as wasmAltStep, nextStatus as wasmNextStatus, statusAfter as wasmStatusAfter, statusBlock as wasmStatusBlock, verdictAfter as wasmVerdictAfter } from "@/wasm/rules";
import type { SubItemsWire } from "@/wasm/rules";

/**
 * What a press on a Task or a Commitment writes, predicted so the board can show it before the
 * server has answered (ADR 0012, decision 13).
 *
 * There is no TypeScript copy of the rule. These call `tasks::rules::gestures` itself, compiled to
 * wasm (`src/wasm/rules.ts`), so the prediction is the writer's own answer and cannot drift from it.
 * `conformance/task-gestures.json` still runs against both ends: `task-gestures-conformance.test.ts`
 * beside this file replays it through the wasm, and
 * `src-tauri/tests/operations/task_gestures_conformance.rs` through Rust.
 */

/** What a status gesture leaves: the status it writes, or why it writes nothing. */
export type StatusPrediction =
  | { outcome: "written"; status: TaskStatus }
  | { outcome: "refused"; reason: StatusRefusal };

/**
 * The status one step of the click/`Enter` cycle moves a Task to, in the model it holds.
 * Ordinary: To Do → In Progress → Done → To Do, and Started resumes to In Progress. Agentic: To Do →
 * Doing → Done → To Do, and Review and On Agent both go to Doing.
 */
export function nextStatus(current: TaskStatus): TaskStatus {
  return wasmNextStatus(current);
}

/**
 * The step `Alt+Enter` takes. Ordinary: Started from anything but Started, and back to In Progress
 * from it. Agentic: Doing is handed back to the agent (On Agent); any other status is refused.
 */
export function altStep(current: TaskStatus): StatusPrediction {
  return wasmAltStep(current);
}

/**
 * What a Task's sub-items say about a press on it: the status they make it read at least, and how
 * many of them are not Done. The board does not carry either to a node, so a prediction made
 * without them (`NO_SUB_ITEMS`) constrains nothing and the backend, which reads them off the board,
 * refuses what they forbid.
 */
export type SubItems = SubItemsWire;

/** A Task whose sub-items say nothing: none, or none begun, and none open. */
export const NO_SUB_ITEMS: SubItems = { floor: "todo", open: 0 };

/** What `step` writes on a Task reading `current`, or why it writes nothing. A Compound Task has no
 * status of its own to write, whatever the gesture; any Task is held to its `subItems`. */
export function statusAfter(step: StatusStep, current: TaskStatus, compound: boolean, subItems: SubItems = NO_SUB_ITEMS): StatusPrediction {
  return wasmStatusAfter(step, current, compound, subItems);
}

/** Why a status cannot be chosen on a Task: it consists purely of its sub-items (`compound`), the
 * status is below the floor they derive, or Done is chosen while a sub-item is open. */
export type StatusBlock = "compound" | "below_sub_items" | "open_sub_items";

/** Why an editor may not offer `status` on a Task, or `null` when it may: what it greys out. */
export function statusBlock(status: TaskStatus, compound: boolean, subItems: SubItems = NO_SUB_ITEMS): StatusBlock | null {
  return wasmStatusBlock(status, compound, subItems);
}

/**
 * The verdict `press` leaves a Commitment reading `current` with. The cycle goes Unresolved → Kept →
 * Broken → Unresolved; the two controls each toggle, so pressing the one a Commitment already reads
 * clears it, and neither moves straight from one verdict to the other.
 */
export function verdictAfter(press: VerdictPress, current: Verdict): Verdict {
  return wasmVerdictAfter(press, current);
}
