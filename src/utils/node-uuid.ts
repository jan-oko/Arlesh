import { uuidV5 } from "@/utils/uuid-v5";

/**
 * The application namespace every minted node id is hashed under. Fixed for good: changing it
 * changes every minted id, which silently orphans each tab's saved selection, collapse state and
 * subtree root (docs/spec/mindmap-view.md, "Node identity").
 */
export const ARLESH_NODE_NAMESPACE = "0d75ff4b-9652-4596-9d2f-1909230b662b";

/**
 * The display key of a node kind added after the composed `kind-<id>` spellings were frozen: a
 * version 5 UUID of its structural key. Deterministic, so a reload keeps selection and collapse;
 * undecodable, so nothing can parse a row id back out of it — read `rowId` instead.
 */
function mint(structuralKey: string): string {
  return uuidV5(structuralKey, ARLESH_NODE_NAMESPACE);
}

/** The node id of the stored Expectation with this row id. */
export function expectationNodeId(expectationId: number): string {
  return mint(`expectation/${expectationId}`);
}

/** The node id of an Expectation's virtual "check on it" task. It draws no row of its own. */
export function checkTaskNodeId(expectationId: number): string {
  return mint(`expectation-check/${expectationId}`);
}

/** The node id of the virtual Expectation a delegated Task waits on. It draws no row of its own. */
export function delegationWaitNodeId(taskId: number): string {
  return mint(`delegation-wait/${taskId}`);
}

/** The node id of the virtual wait an Asynchronous Task's completion spawned. It draws no row. */
export function spawnedWaitNodeId(taskId: number): string {
  return mint(`spawned-wait/${taskId}`);
}

/** The node id of a spawned wait's virtual check task. It draws no row. */
export function spawnedCheckNodeId(taskId: number): string {
  return mint(`spawned-check/${taskId}`);
}
