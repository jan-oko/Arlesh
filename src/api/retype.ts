import { invoke } from "./gesture";
import { isWireError } from "@/api/errors";
import type { TimeScope } from "@/api/time-scope";

/** The node kinds `retype_node` can move between: the goals, tasks, commitments and domains
 * tables, and infos. */
export type RetypeKind = "goal" | "task" | "commitment" | "domain" | "project" | "tag" | "info";

const RETYPE_KINDS: readonly string[] = [
  "goal",
  "task",
  "commitment",
  "domain",
  "project",
  "tag",
  "info",
] satisfies readonly RetypeKind[];

/**
 * Narrows a node kind to one the backend command handles, or `null`.
 *
 * `flow`, `flow_goal`, `flow_task` and `aspect` are not retypeable through this command; the
 * caller keeps its own path for the first three and refuses the last.
 */
export function asRetypeKind(kind: string): RetypeKind | null {
  return isRetypeKind(kind) ? kind : null;
}

function isRetypeKind(value: string): value is RetypeKind {
  return RETYPE_KINDS.includes(value);
}

/** What to do with the children the new kind cannot hold. */
export type StrandedChildren = "reparent" | "delete";

export const STRANDED_CHILDREN = {
  REPARENT: "reparent",
  DELETE: "delete",
} as const;

/** The node a retype produced. Its id is unchanged for a retype inside the domains table. */
export interface RetypedNode {
  kind: RetypeKind;
  id: number;
}

/** A child the new kind cannot hold. */
export interface LostChild {
  kind: string;
  id: number;
  title: string;
}

/** A field the new kind has no counterpart for. `field` is a stable i18n key suffix. */
export interface LostField {
  field: string;
  value: string;
}

/** One end of a {@link ParentClimb}: a parent's kind, id and title, named for a prompt. */
export interface NamedParent {
  kind: string;
  id: number;
  title: string;
}

/**
 * A retype whose target's `parent_type` cannot accept the node's current parent, so the backend
 * would move it further up the tree — to the nearest ancestor the target does accept. Named so the
 * prompt can say "this will move it out from under {@link from} to {@link to}".
 */
export interface ParentClimb {
  from: NamedParent;
  to: NamedParent;
}

/** The `details` payload of the `needs_confirmation` refusal: everything a retype would destroy
 * or move. `parent_climb` is `null` when the node's parent needs no change. */
export interface RetypeLosses {
  lost_children: LostChild[];
  lost_fields: LostField[];
  parent_climb: ParentClimb | null;
}

function isLostChild(value: unknown): value is LostChild {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("id" in value) || !("title" in value)) return false;
  return (
    typeof value.kind === "string" &&
    typeof value.id === "number" &&
    typeof value.title === "string"
  );
}

function isLostField(value: unknown): value is LostField {
  if (typeof value !== "object" || value === null) return false;
  if (!("field" in value) || !("value" in value)) return false;
  return typeof value.field === "string" && typeof value.value === "string";
}

function isNamedParent(value: unknown): value is NamedParent {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("id" in value) || !("title" in value)) return false;
  return (
    typeof value.kind === "string" &&
    typeof value.id === "number" &&
    typeof value.title === "string"
  );
}

/**
 * Parses the optional `parent_climb` key of a `needs_confirmation` payload.
 *
 * Tolerant of the key being absent entirely rather than `null` — older payloads, and every test
 * fixture written before this key existed, only ever set `lost_children`/`lost_fields`.
 */
function parseParentClimb(details: object): ParentClimb | null {
  if (!("parent_climb" in details)) return null;
  const value = details.parent_climb;
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return null;
  if (!("from" in value) || !("to" in value)) return null;
  if (!isNamedParent(value.from) || !isNamedParent(value.to)) return null;
  return { from: value.from, to: value.to };
}

/**
 * Narrows a rejection to the refusal `retype_node` raises when a retype would destroy or move
 * something.
 *
 * Returns the losses to put to the user, or `null` for any other rejection — which the caller
 * must then surface as a real failure rather than treat as a prompt.
 */
export function retypeLosses(error: unknown): RetypeLosses | null {
  if (!isWireError(error) || error.kind !== "needs_confirmation") return null;
  const { details } = error;
  if (typeof details !== "object" || details === null) return null;
  if (!("lost_children" in details) || !("lost_fields" in details)) return null;
  const { lost_children: children, lost_fields: fields } = details;
  if (!Array.isArray(children) || !Array.isArray(fields)) return null;
  if (!children.every(isLostChild) || !fields.every(isLostField)) return null;
  return { lost_children: children, lost_fields: fields, parent_climb: parseParentClimb(details) };
}

/**
 * Narrows a rejection to the refusal a retype to Commitment raises when the node has no window to
 * be held over — neither its own nor a scoped ancestor's.
 *
 * Not a failure and not a confirmation: what is missing is information, and the answer is the
 * same retype again carrying a `timeScope`. It has its own wire kind precisely so this can be
 * told apart without reading the message.
 */
export function needsTimeScope(error: unknown): boolean {
  return isWireError(error) && error.kind === "needs_time_scope";
}

/**
 * Retypes a node in one atomic backend call.
 *
 * Rejects with a `needs_confirmation` wire error — read it with {@link retypeLosses} — when the
 * retype would strand a child or drop a field and `strandedChildren` has not been supplied.
 * Passing `strandedChildren` is the acknowledgement, and chooses what happens to the children
 * the new kind cannot hold.
 *
 * Rejects with `needs_time_scope` — read it with {@link needsTimeScope} — when the target is a
 * Commitment and nothing gives the node an effective window. `timeScope` is the answer, and rides
 * on the retype itself so the whole thing stays one atomic write: a cancelled prompt leaves the
 * node exactly as it was, rather than scoped for a retype that never happened.
 */
export async function retypeNode(
  nodeType: RetypeKind,
  nodeId: number,
  targetType: RetypeKind,
  strandedChildren?: StrandedChildren,
  timeScope?: TimeScope,
): Promise<RetypedNode> {
  return invoke<RetypedNode>("retype_node", {
    nodeType,
    nodeId,
    targetType,
    strandedChildren: strandedChildren ?? null,
    timeScope: timeScope ?? null,
  });
}
