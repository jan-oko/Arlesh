import { useMemo } from "react";
import { useDisplayStore } from "@/stores/use-display-store";
import { collectSearchableNodes } from "@/utils/mindmap-tree";
import type { SearchableNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The nodes a node search offers — `Ctrl+O` in every view, and the node pools of the filter
 * searches — leaving archived subtrees out unless Settings → General says to include them.
 */
export function useSearchableNodes(tree: MindmapNode): SearchableNode[] {
  const includeArchived = useDisplayStore((s) => s.searchIncludesArchived);
  return useMemo(() => collectSearchableNodes(tree, { skipArchived: !includeArchived }), [tree, includeArchived]);
}
