import type { RowId } from "@/api/node-id";
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

/** The node id of the Expectation with this row id — a stored one's integer, or a derived one's
 * UUID (a Task's spawned wait, a delegated Task's wait). */
export function expectationNodeId(expectationId: RowId): string {
  return mint(`expectation/${expectationId}`);
}
