import { invoke } from "./gesture";
import type { TimeScope } from "@/api/time-scope";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import { isWireError } from "@/api/errors";

/** A Task's own stored archival state. Two values only: a Task is never manually Archived, and
 * Frozen is Goal/Project vocabulary. */
export type TaskArchival = "live" | "backlog";

export const TASK_ARCHIVAL = {
  LIVE: "live",
  BACKLOG: "backlog",
} as const;

/** A Task's Agentic state as an update names it. Three states, not two: a Task with no value of
 * its own inherits from its nearest flagged ancestor, and `"inherit"` is how an update puts it
 * back to that. Sending it as a named state rather than as `null` keeps "leave the flag alone"
 * (the field absent) distinguishable from "clear it". */
export type TaskAgentic = "inherit" | "yes" | "no";

export const TASK_AGENTIC = {
  INHERIT: "inherit",
  YES: "yes",
  NO: "no",
} as const;

/** A Task delegated to a Person, by the Person's id. */
export interface PersonDelegate {
  kind: "person";
  id: number;
}

/** A Task delegated to the Agent. There is one Agent target, so it carries no id. */
export interface AgentDelegate {
  kind: "agent";
}

/** Who holds a delegated Task: a Person or the Agent. Independent of the Agentic flag, which says
 * only that the work suits an agent. */
export type Delegate = PersonDelegate | AgentDelegate;

export interface Task {
  id: number;
  title: string;
  parent_type: string;
  parent_id: number;
  status: string;
  delegate_to: Delegate | null;
  // This task's own flag: true/false when it says so itself, null when it inherits the nearest
  // flagged ancestor's. Independent of delegate_to — a task can be both.
  agentic: boolean | null;
  // Whether doing this task starts a wait rather than finishing something. A plain boolean, not a
  // third state: the flag does not inherit, so there is nothing for a null to carry.
  asynchronous: boolean;
  time_scope: TimeScope | null;
  // Present iff time_scope is (inherited with the window otherwise).
  on_scope_exit: OnScopeExit | null;
  plan: TimeScope | null;
  archival: TaskArchival;
  tag_ids: number[];
  position: number;
  is_private: boolean;
  // The bd issue this task is tracked as; absent when it is tracked as none. Written only by the
  // MCP server — no update request carries it.
  beads_id?: string;
}

export interface CreateTaskRequest {
  title: string;
  parent_type: string;
  parent_id: number;
  status?: string;
  time_scope?: TimeScope;
  // Applied only when time_scope is set (defaults to "keep").
  on_scope_exit?: OnScopeExit;
  plan?: TimeScope;
  archival?: TaskArchival;
  agentic?: TaskAgentic;
  asynchronous?: boolean;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: string;
  // Absent = leave unchanged, null = clear, value = set.
  delegate_to?: Delegate | null;
  // Absent = leave unchanged; "inherit" puts the task back to reading its ancestors.
  agentic?: TaskAgentic;
  // Absent = leave unchanged; false is a real answer that unflags the task.
  asynchronous?: boolean;
  // Absent = leave unchanged, null = clear, value = set.
  time_scope?: TimeScope | null;
  // Forced null when the scope is cleared; defaulted to "keep" when a scope is set without one.
  on_scope_exit?: OnScopeExit | null;
  plan?: TimeScope | null;
  // Absent = leave unchanged. Backlogging a task that keeps its Plan is refused — see
  // `backlogNeedsPlanCleared` — so the two are sent together to clear the plan and backlog at once.
  archival?: TaskArchival;
  parent_type?: string;
  parent_id?: number;
  position?: number;
  is_private?: boolean;
}

export async function listTasks(): Promise<Task[]> {
  return invoke<Task[]>("list_tasks");
}

export async function createTask(request: CreateTaskRequest): Promise<Task> {
  return invoke<Task>("create_task", { request });
}

export async function updateTask(id: number, request: UpdateTaskRequest): Promise<Task> {
  return invoke<Task>("update_task", { id, request });
}

export async function deleteTask(id: number): Promise<void> {
  return invoke<void>("delete_task", { id });
}

export async function duplicateTask(
  id: number,
  targetType: string,
  targetId: number,
  position: number,
): Promise<Task> {
  return invoke<Task>("duplicate_task", { id, targetType, targetId, position });
}

/**
 * Whether `error` is `update_task` refusing to backlog a task that still has a Plan.
 *
 * A Task is never both set aside and scheduled, so the backend stops rather than throwing a
 * scheduling decision away unasked. Answering means repeating the same call with the Plan cleared:
 * `updateTask(id, { archival: "backlog", plan: null })`. Anything else is a real failure and must
 * be surfaced as one.
 *
 * `update_task` raises no other confirmation, so the kind alone identifies it — unlike
 * `retype_node`, whose refusal carries a payload naming what is at stake.
 */
export function backlogNeedsPlanCleared(error: unknown): boolean {
  return isWireError(error) && error.kind === "needs_confirmation";
}

export interface ViolatingDescendant {
  node_type: string;
  node_id: number;
}

export interface ReparentConflicts {
  ancestor_time_scope: TimeScope | null;
  conflicts: ViolatingDescendant[];
}

/**
 * Items a reparent of `node` under `newParent` would orphan, plus the ancestor Time Scope to
 * clamp them to. Call before a drag reparent to drive a clamp-or-cancel prompt.
 */
export async function reparentScopeConflicts(
  nodeType: string,
  nodeId: number,
  newParentType: string,
  newParentId: number,
): Promise<ReparentConflicts> {
  return invoke<ReparentConflicts>("reparent_scope_conflicts", {
    nodeType,
    nodeId,
    newParentType,
    newParentId,
  });
}

/**
 * Descendants a candidate Time Scope would orphan (their explicit window would fall outside it).
 * Call before narrowing a node's scope or reparenting to drive a clamp-or-cancel prompt.
 */
export async function scopeContainmentConflicts(
  nodeType: string,
  nodeId: number,
  timeScope: TimeScope,
): Promise<ViolatingDescendant[]> {
  return invoke<ViolatingDescendant[]>("scope_containment_conflicts", {
    nodeType,
    nodeId,
    timeScope,
  });
}

export type Dependency =
  | { type: "task"; id: number }
  | { type: "goal"; id: number }
  | { type: "expectation"; id: number };

export interface TaskWithBlockers {
  task: Task;
  block_reasons: string[];
}

export async function getTask(id: number): Promise<TaskWithBlockers> {
  return invoke<TaskWithBlockers>("get_task", { id });
}

export async function listTaskDependencies(taskId: number): Promise<Dependency[]> {
  return invoke<Dependency[]>("list_task_dependencies", { taskId });
}

/** A single dependency edge: `task_id` depends on `(dependency_type, dependency_id)`. */
export interface TaskDependencyEdge {
  task_id: number;
  dependency_type: string; // "task" | "goal" | "expectation"
  dependency_id: number;
}

/** Every task-dependency edge (for the mindmap bulk load / virtual block-reason derivation). */
export async function listAllTaskDependencies(): Promise<TaskDependencyEdge[]> {
  return invoke<TaskDependencyEdge[]>("list_all_task_dependencies");
}

export async function addTaskDependency(taskId: number, dependency: Dependency): Promise<void> {
  return invoke<void>("add_task_dependency", { taskId, dependency });
}

export async function removeTaskDependency(taskId: number, dependency: Dependency): Promise<void> {
  return invoke<void>("remove_task_dependency", { taskId, dependency });
}

export async function addTagToTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("add_tag_to_task", { taskId, tagId });
}

export async function removeTagFromTask(taskId: number, tagId: number): Promise<void> {
  return invoke<void>("remove_tag_from_task", { taskId, tagId });
}
