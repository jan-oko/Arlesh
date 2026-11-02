import type { Commitment } from "@/api/commitments";
import type { Expectation } from "@/api/expectations";
import type { Goal } from "@/api/goals";
import type { Task } from "@/api/tasks";
import type { WriteResult } from "@/stores/use-pending-writes-store";
import type { OwnFields } from "@/utils/pending-writes";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The own fields a write's response row carries, for the lane to show in place of the prediction
 * once the server has answered (ADR 0012, decision 2). Only own fields: whatever is derived waits
 * for the board that follows.
 */

/** A Task row's own status, as the board spells it. */
export function taskAnswerFields(task: Task): OwnFields {
  return { status: task.status.status, taskStatus: task.status };
}

/** A Goal row's own status. */
export function goalAnswerFields(goal: Goal): OwnFields {
  return { status: goal.status };
}

/** An Expectation row's own status (Pending or Released). */
export function expectationAnswerFields(expectation: Expectation): OwnFields {
  return { status: expectation.status };
}

/** A Commitment row's own verdict. */
export function commitmentAnswerFields(commitment: Commitment): OwnFields {
  return { verdict: commitment.verdict };
}

/** A write the server took, answering with `fields`. */
export function writtenWith(fields: OwnFields): WriteResult {
  return { outcome: "written", response: { epoch: null, revision: null, fields, createdId: null } };
}

/**
 * A create the server took, answering with the node it made: its real id and row, and the own
 * fields the response carried (ADR 0012, decision 8). The board that follows replaces all of it.
 */
export function createdWrite(node: MindmapNode): WriteResult {
  const fields: OwnFields = {
    title: node.title,
    ...(node.status === undefined ? {} : { status: node.status }),
    ...(node.taskStatus === undefined ? {} : { taskStatus: node.taskStatus }),
    ...(node.verdict === undefined ? {} : { verdict: node.verdict }),
  };
  return {
    outcome: "written",
    response: {
      epoch: null, revision: null, fields, createdId: node.id,
      ...(node.rowId === undefined ? {} : { createdRowId: node.rowId }),
    },
  };
}
