import type { StatusRefusal, StatusStep, VerdictPress } from "@/api/node-gestures";
import type { TaskStatus } from "@/api/tasks";
import type { Verdict } from "@/api/verdict";
import { AGENTIC_STATUS, TASK_STATUS, agentic, ordinary } from "@/utils/status-mapping";

/**
 * What a press on a Task or a Commitment writes, predicted so the board can show it before the
 * server has answered (ADR 0012, decision 13).
 *
 * This is a **pinned copy** of `tasks::rules::gestures` in Rust, which stays the definition and the
 * writer. `conformance/task-gestures.json` runs against both: `task-gestures-conformance.test.ts`
 * beside this file and `src-tauri/tests/operations/task_gestures_conformance.rs`. The answer the
 * server sends replaces this prediction, so a difference between the two shows for one round trip
 * at most.
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
  if (current.kind === "ordinary") {
    switch (current.status) {
      case TASK_STATUS.IN_PROGRESS: return ordinary(TASK_STATUS.DONE);
      case TASK_STATUS.DONE: return ordinary(TASK_STATUS.TODO);
      case TASK_STATUS.TODO:
      case TASK_STATUS.STARTED: return ordinary(TASK_STATUS.IN_PROGRESS);
    }
  }
  switch (current.status) {
    case AGENTIC_STATUS.DOING: return agentic(AGENTIC_STATUS.DONE);
    case AGENTIC_STATUS.DONE: return agentic(AGENTIC_STATUS.TODO);
    case AGENTIC_STATUS.TODO:
    case AGENTIC_STATUS.REVIEW:
    case AGENTIC_STATUS.ON_AGENT: return agentic(AGENTIC_STATUS.DOING);
  }
}

/**
 * The step `Alt+Enter` takes. Ordinary: Started from anything but Started, and back to In Progress
 * from it. Agentic: Doing is handed back to the agent (On Agent); any other status is refused.
 */
export function altStep(current: TaskStatus): StatusPrediction {
  if (current.kind === "agentic") {
    return current.status === AGENTIC_STATUS.DOING
      ? { outcome: "written", status: agentic(AGENTIC_STATUS.ON_AGENT) }
      : { outcome: "refused", reason: "alt_enter_agentic_not_doing" };
  }
  return {
    outcome: "written",
    status: ordinary(current.status === TASK_STATUS.STARTED ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.STARTED),
  };
}

/** What `step` writes on a Task reading `current`, or why it writes nothing. A Compound Task has no
 * status of its own to write, whatever the gesture. */
export function statusAfter(step: StatusStep, current: TaskStatus, compound: boolean): StatusPrediction {
  if (compound) return { outcome: "refused", reason: "compound" };
  return step === "advance" ? { outcome: "written", status: nextStatus(current) } : altStep(current);
}

/**
 * The verdict `press` leaves a Commitment reading `current` with. The cycle goes Unresolved → Kept →
 * Broken → Unresolved; the two controls each toggle, so pressing the one a Commitment already reads
 * clears it, and neither moves straight from one verdict to the other.
 */
export function verdictAfter(press: VerdictPress, current: Verdict): Verdict {
  if (press === "cycle") {
    switch (current) {
      case "unresolved": return "kept";
      case "kept": return "broken";
      case "broken": return "unresolved";
    }
  }
  return current === press ? "unresolved" : press;
}
