import { invoke } from "./gesture";
import type { RowId } from "./node-id";
import { TASK_ARCHIVAL } from "./tasks";
import { COMMITMENT_ARCHIVAL } from "./commitments";
import { domainArchiveStatus } from "@/utils/hand-archive";

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
  | "save-flow" | "save-flow-item" | "new-flow" | "archive-nodes";

/**
 * A node a write acts on: its id; the node an earlier write of the same gesture made; or the node
 * that replaces `id` in the Habit an earlier write forked (`forked` names its kind: `flow` or a
 * Flow item kind), `id` itself when that write forked nothing.
 */
export type StepTarget = RowId | { step: number } | { step: number; forked: string; id: number };

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

/** A node's own archive write: what puts it away by hand, or brings it back. */
export interface ArchiveWrite {
  kind: "task" | "commitment" | "domain";
  id: RowId;
  archive: boolean;
}

/**
 * Archives — or unarchives — every node in `writes` as **one** gesture: one transaction, one undo
 * step. It runs as the `archive-nodes` gesture, which admits the three updates a hand archive is
 * made of and nothing that moves or deletes.
 */
export async function archiveNodes(writes: ArchiveWrite[]): Promise<void> {
  await runGesture("archive-nodes", writes.map(archiveStep));
}

function archiveStep({ kind, id, archive }: ArchiveWrite): GestureStep {
  if (kind === "domain") return { op: "update_domain", id, request: { status: domainArchiveStatus(archive) } };
  if (kind === "commitment") return { op: "update_commitment", id, request: { archival: archive ? COMMITMENT_ARCHIVAL.ARCHIVED : COMMITMENT_ARCHIVAL.LIVE } };
  return { op: "update_task", id, request: { archival: archive ? TASK_ARCHIVAL.ARCHIVED : TASK_ARCHIVAL.LIVE } };
}
