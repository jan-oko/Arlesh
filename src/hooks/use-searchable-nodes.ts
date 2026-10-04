import { useMemo } from "react";
import { useDisplayStore } from "@/stores/use-display-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { delegatedModeOf } from "@/utils/filter-tree";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import type { SearchableNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The nodes a node search offers — `Ctrl+O` in every view, and the node pools of the filter
 * searches — leaving archived nodes (each judged by its own archival) out unless Settings → General says to include them,
 * and delegated Tasks out unless the Delegated pill is on Include.
 */
export function useSearchableNodes(tree: MindmapNode): SearchableNode[] {
  const includeArchived = useDisplayStore((s) => s.searchIncludesArchived);
  const skipDelegated = useFilterStore((s) => delegatedModeOf(s.filter) !== "include");
  return useMemo(
    () => collectSearchableNodes(tree, { skipArchived: !includeArchived, skipDelegated }),
    [tree, includeArchived, skipDelegated],
  );
}
