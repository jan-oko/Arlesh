import { invoke } from "@tauri-apps/api/core";
import { isWireError } from "@/api/errors";

/** The node kinds `retype_node` can move between: the goals, tasks and domains tables. */
export type RetypeKind = "goal" | "task" | "domain" | "project" | "tag";

const RETYPE_KINDS: readonly string[] = [
  "goal",
  "task",
  "domain",
  "project",
  "tag",
] satisfies readonly RetypeKind[];

/**
 * Narrows a node kind to one the backend command handles, or `null`.
 *
 * `info`, `flow`, `flow_goal`, `flow_task` and `aspect` are not retypeable through this command;
 * the caller keeps its own paths for the first four and refuses the last.
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

/** The `details` payload of the `needs_confirmation` refusal: everything a retype would destroy. */
export interface RetypeLosses {
  lost_children: LostChild[];
  lost_fields: LostField[];
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

/**
 * Narrows a rejection to the refusal `retype_node` raises when a retype would destroy something.
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
  return { lost_children: children, lost_fields: fields };
}

/**
 * Retypes a node in one atomic backend call.
 *
 * Rejects with a `needs_confirmation` wire error — read it with {@link retypeLosses} — when the
 * retype would strand a child or drop a field and `strandedChildren` has not been supplied.
 * Passing `strandedChildren` is the acknowledgement, and chooses what happens to the children
 * the new kind cannot hold.
 */
export async function retypeNode(
  nodeType: RetypeKind,
  nodeId: number,
  targetType: RetypeKind,
  strandedChildren?: StrandedChildren,
): Promise<RetypedNode> {
  return invoke<RetypedNode>("retype_node", {
    nodeType,
    nodeId,
    targetType,
    strandedChildren: strandedChildren ?? null,
  });
}
