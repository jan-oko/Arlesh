import { useMemo } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import type { ScopeWindows } from "@/utils/scope-interval";
import { NO_SCOPE_WINDOWS } from "@/utils/scope-interval";
import type { ScopeSelection } from "@/utils/scope-match";
import { referencedScopeIdsInTree } from "@/utils/scope-match";
import { useScopeWindows } from "@/hooks/use-scope-windows";

/** Nothing to resolve. A stable value, so the memo below does not re-run on identity alone. */
const NO_IDS: number[] = [];

/**
 * The windows a view needs before it can answer the scope selector: every scope the tree names,
 * plus the selection's own two endpoints.
 *
 * Resolved **only while a selection is set**. The scope filter is the one axis that reads windows
 * rather than flags, so a board with no scope picked pays nothing for it; the windows themselves
 * are cached for the session, since a scope is immutable once created.
 *
 * While the resolution is in flight the map is incomplete, and an incomplete map narrows nothing
 * rather than emptying the view — see `resolveScopeFilter`.
 */
export function useScopeFilterWindows(
  root: MindmapNode,
  selection: ScopeSelection | null,
): ScopeWindows {
  const ids = useMemo(
    () => (selection === null ? NO_IDS : referencedScopeIdsInTree(root, selection)),
    [root, selection],
  );
  const windows = useScopeWindows(ids);
  return selection === null ? NO_SCOPE_WINDOWS : windows;
}
