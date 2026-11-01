import type { TaskAgentic } from "@/api/tasks";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { ExpectationSaveData } from "@/components/ExpectationEditorModal/ExpectationEditorModal";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { InfoSaveData } from "@/components/InfoEditorModal/InfoEditorModal";
import type { OwnFields } from "@/utils/pending-writes";
import type { MindmapNode } from "@/utils/tree-layout";
import { storedStatus, taskStatusOf } from "@/utils/status-mapping";

/**
 * What a node shows once an editor's Save is on its way (ADR 0012, decisions 2 and 12): the form's
 * own values and nothing derived. Each function returns only fields the node holds as its own, so
 * an inherited Plan, Overdue or Blocked flag changes with the reload that follows the answer.
 */

/** The title a node draws once its row title is `title`: a label round it (an iteration root's
 * scope, a delegation wait's tag) stays where it was. */
export function shownTitle(node: MindmapNode, title: string): string {
  const row = node.rowTitle;
  if (row === undefined || row === "" || !node.title.includes(row)) return title;
  return node.title.replace(row, () => title);
}

function agenticFlag(state: TaskAgentic): boolean | null {
  if (state === "inherit") return null;
  return state === "yes";
}

/** A Task's Save. A Task that stays Compound gets no status patch; the status the form leaves is
 * already the one `convertedStatus` gives when the Agentic flag changed. Review is derived, so a
 * form that leaves it where it was patches nothing. */
export function taskSaveFields(node: MindmapNode, data: TaskSaveData): OwnFields {
  const keepsDerived = node.compound === true && data.compound;
  const target = storedStatus(data.status);
  const current = storedStatus(taskStatusOf(node));
  const statusMoved = target.kind !== current.kind || target.status !== current.status;
  return {
    title: shownTitle(node, data.title),
    ...(keepsDerived || !statusMoved ? {} : { status: target.status, taskStatus: target }),
    timeScope: data.timeScope,
    onScopeExit: data.onScopeExit,
    plan: data.plan,
    ...(data.dueScope !== undefined ? { dueScope: data.dueScope } : {}),
    agentic: agenticFlag(data.agentic),
    asynchronous: data.asynchronous,
    agenticBrief: data.agenticBrief,
    tagIds: data.tagIds,
    blockReasons: data.blockReasons,
  };
}

/** A Goal's Save. */
export function goalSaveFields(node: MindmapNode, data: GoalSaveData): OwnFields {
  return {
    title: shownTitle(node, data.title),
    status: data.status,
    timeScope: data.timeScope,
    onScopeExit: data.onScopeExit,
    tagIds: data.tagIds,
    blockReasons: data.blockReasons,
  };
}

/** A Commitment's Save. */
export function commitmentSaveFields(node: MindmapNode, data: CommitmentSaveData): OwnFields {
  return {
    title: shownTitle(node, data.title),
    verdict: data.verdict,
    timeScope: data.timeScope,
    tagIds: data.tagIds,
  };
}

/** A wait's Save. */
export function expectationSaveFields(node: MindmapNode, data: ExpectationSaveData): OwnFields {
  return {
    title: shownTitle(node, data.title),
    status: data.status,
    timeScope: data.timeScope,
    tagIds: data.tagIds,
  };
}

/** A Project's Save. A blank status field leaves the status alone. */
export function projectSaveFields(node: MindmapNode, data: ProjectSaveData): OwnFields {
  return {
    title: shownTitle(node, data.title),
    ...(data.status !== "" ? { status: data.status } : {}),
  };
}

/** A Domain's or Tag's Save. */
export function simpleSaveFields(node: MindmapNode, title: string): OwnFields {
  return { title: shownTitle(node, title) };
}

/** An Info's Save: its body is the title it is drawn with. */
export function infoSaveFields(data: InfoSaveData): OwnFields {
  return { title: data.body, infoDetails: data.details };
}
