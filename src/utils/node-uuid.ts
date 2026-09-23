import type { RowId } from "@/api/node-id";
import { uuidV5 } from "@/utils/uuid-v5";
import type { WaitRef } from "@/utils/tree-layout";

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

/** The key an Expectation's **open** check's lifecycle is filed under: the backend times "the wait's
 * next check", not one check by its instant. The check's node id is {@link checkNodeId}. */
export function checkTaskNodeId(expectationId: number): string {
  return mint(`expectation-check/${expectationId}`);
}

/** The node id of the virtual Expectation a delegated Task waits on. It draws no row of its own. */
export function delegationWaitNodeId(taskId: RowId): string {
  return mint(`delegation-wait/${taskId}`);
}

/** The node id of the virtual wait an Asynchronous Task's completion spawned. It draws no row. */
export function spawnedWaitNodeId(taskId: RowId): string {
  return mint(`spawned-wait/${taskId}`);
}

/** The key a spawned wait's open check's lifecycle is filed under, as {@link checkTaskNodeId}. Also
 * the check's node id in the one case its due instant is unknown. */
export function spawnedCheckNodeId(taskId: RowId): string {
  return mint(`spawned-check/${taskId}`);
}

/**
 * The node id of a wait's check task, open or completed: the wait, plus the instant the check fell
 * due. A wait has one open check but many done ones, and completing a check keeps its id, so the
 * selection and the focus exemption hold it through the reload.
 */
export function checkNodeId(wait: WaitRef, dueAt: string): string {
  return wait.kind === "stored"
    ? mint(`expectation-check/${wait.expectationId}/${dueAt}`)
    : mint(`spawned-check/${wait.taskId}/${dueAt}`);
}
