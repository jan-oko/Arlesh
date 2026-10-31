import { invoke } from "./gesture";
import type { RowId } from "./node-id";

/**
 * The gesture operations: a gesture the app makes over several nodes, as **one** command — one
 * transaction, one Gesture, one undo step, in Standalone and against a server alike (see
 * docs/spec/client-mode.md, *Undo*).
 */

/** One node a gesture acts on: its kind as the board names it, and its id. */
export interface GestureNode {
  kind: string;
  id: RowId;
}

/** Deletes every node in `nodes`, all or nothing. */
export async function deleteNodes(nodes: GestureNode[]): Promise<void> {
  await invoke<null>("delete_nodes", { nodes });
}

/** The gesture operations made of listed writes, each its own route on a server. */
export type GestureName =
  | "paste" | "insert-parent" | "move-node" | "plan-tasks" | "plan-move"
  | "save-task" | "save-goal" | "save-commitment" | "save-project" | "save-wait"
  | "save-flow" | "save-flow-item" | "new-flow";

/** A node a write acts on: its id, or the node an earlier write of the same gesture made. */
export type StepTarget = RowId | { step: number };

/**
 * One write of a gesture: `op` names it and the rest are its arguments, as the backend's
 * `GestureStep` reads them (`crates/arlesh-core/src/nodes/gestures/steps.rs`). `may_be_refused`
 * lets the gesture go on without it when it is refused.
 */
export type GestureStep = { op: string; may_be_refused?: boolean } & Record<string, unknown>;

/** What a write marked `may_be_refused` answers when it was refused. */
export interface RefusedStep {
  refused: { kind: string; message: string; details?: unknown };
}

export function isRefusedStep(answer: unknown): answer is RefusedStep {
  return typeof answer === "object" && answer !== null && "refused" in answer;
}

/**
 * Runs the gesture `name` — `steps`, in order — as one command: one transaction and one undo step,
 * here and against a server. Answers each write's result, in order. All or nothing, except a write
 * marked `may_be_refused`.
 */
export async function runGesture(name: GestureName, steps: GestureStep[]): Promise<unknown[]> {
  return invoke<unknown[]>("run_gesture", { name, steps });
}
