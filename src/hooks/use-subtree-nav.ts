import { useCallback, useEffect } from "react";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { findNode, findParent } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

interface SubtreeNavHandles {
  /** The node the view is currently re-rooted at, or null at the true root. */
  subtreeRootId: string | null;
  /** Where "up one level" lands — null once the level above is the true root. */
  parentSubtreeId: string | null;
  /** Up one level. */
  onExitSubtree: () => void;
  /** Straight back to the true root. */
  onExitToRoot: () => void;
}

/**
 * Resolves the current subtree's descriptor — where you are, and the two ways back out — publishes
 * it for the top bar, and hands back the two "go up" actions.
 *
 * The top bar holds no tree, so whichever view is on screen has to name the subtree root's parent
 * for it. Both views call this, because `subtreeRootId` is one piece of state **per tab** rather
 * than per view: enter a subtree in the List View and switch to the Mindmap and you are still
 * inside it, and the pills read correctly either way round — while another tab stays exactly where
 * it was, since it holds its own store. Only the Mindmap used to compute the descriptor, so
 * without this the pills would simply vanish whenever the List View was the view on screen — the
 * Mindmap is unmounted then, and the descriptor it last published would go stale.
 */
export function useSubtreeNav(tree: MindmapNode): SubtreeNavHandles {
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const setSubtreeNav = useMindmapStore((s) => s.setSubtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const onExitToRoot = useMindmapStore((s) => s.exitToRoot);

  const current = subtreeRootId !== null ? findNode(tree, subtreeRootId) : undefined;
  const parent = subtreeRootId !== null ? findParent(tree, subtreeRootId) : null;
  const parentSubtreeId = parent !== null && parent.id !== "root" ? parent.id : null;
  const currentTitle = current?.title ?? "";

  /**
   * A subtree root that is no longer on the board sends the view back to the true root.
   *
   * A tab's root is restored from storage, so the node it names may have been deleted in between —
   * and a view rooted at a node that does not exist shows nothing, with no indicator and no pill to
   * escape by. An empty tree is not evidence of that: it is what a load in progress looks like, so
   * the check waits for a tree with something in it.
   */
  useEffect(() => {
    if (subtreeRootId === null || tree.children.length === 0) return;
    if (findNode(tree, subtreeRootId) !== undefined) return;
    onExitToRoot();
  }, [subtreeRootId, tree, onExitToRoot]);

  useEffect(() => {
    setSubtreeNav(
      subtreeRootId === null
        ? null
        : { currentTitle, rootTitle: tree.title, parentTitle: parent?.title ?? tree.title, parentSubtreeId },
    );
  }, [subtreeRootId, tree, parent, parentSubtreeId, currentTitle, setSubtreeNav]);

  const onExitSubtree = useCallback(() => exitSubtree(parentSubtreeId), [exitSubtree, parentSubtreeId]);

  return { subtreeRootId, parentSubtreeId, onExitSubtree, onExitToRoot };
}
