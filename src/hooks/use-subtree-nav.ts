import { useCallback, useEffect, useMemo } from "react";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { SubtreeCrumb, SubtreeNav } from "@/stores/use-mindmap-store";
import { useFoldReading } from "@/hooks/use-fold-reading";
import { drawnPathToNode, fallbackRootFor } from "@/utils/drawn-path";
import { migratedNodeId } from "@/utils/legacy-node-id";
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
 * Resolves the current subtree's descriptor — where you are, and every level above it — publishes
 * it for the top bar, and hands back the two "go up" actions.
 *
 * The top bar holds no tree, so whichever view is on screen has to name the chain above the subtree
 * root for it. Both views call this, because `subtreeRootId` is one piece of state **per tab**
 * rather than per view: enter a subtree in the List View and switch to the Mindmap and you are
 * still inside it, and the breadcrumb reads correctly either way round — while another tab stays
 * exactly where it was, since it holds its own store. Only the Mindmap used to compute the
 * descriptor, so without this the breadcrumb would simply vanish whenever the List View was the
 * view on screen — the Mindmap is unmounted then, and the descriptor it last published would go
 * stale.
 *
 * This is the one place that answers "where am I": the bar consumes what is published here and
 * derives nothing of its own.
 */
export function useSubtreeNav(tree: MindmapNode): SubtreeNavHandles {
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const setSubtreeNav = useMindmapStore((s) => s.setSubtreeNav);
  const publishedNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const onExitToRoot = useMindmapStore((s) => s.exitToRoot);
  const enterSubtree = useMindmapStore((s) => s.enterSubtree);

  // One walk down to the subtree root gives the whole chain: the root itself is the last step, and
  // everything before it is an ancestor the breadcrumb can offer as a way out. It is the walk down
  // the tree **as drawn**, so a folded run of Habit history and each scope level under it is a
  // crumb of its own — and a root that is one of them resolves at all (`drawn-path.ts`).
  const reading = useFoldReading();
  const path = useMemo(
    () => (subtreeRootId === null ? [] : drawnPathToNode(tree, subtreeRootId, reading)),
    [tree, subtreeRootId, reading],
  );
  const current = path[path.length - 1];
  const currentTitle = current?.title ?? "";

  // The true root is nobody's subtree, so it is the one crumb that carries no id — clicking it
  // leaves the subtree entirely rather than re-rooting at a node.
  const ancestors = useMemo<readonly SubtreeCrumb[]>(
    () => path.slice(0, -1).map((node) => ({ id: node.id === "root" ? null : node.id, title: node.title })),
    [path],
  );
  const parentSubtreeId = ancestors[ancestors.length - 1]?.id ?? null;

  /**
   * A subtree root that is no longer on the board sends the view back to the true root.
   *
   * A tab's root is restored from storage, so the node it names may have been deleted in between —
   * and a view rooted at a node that does not exist shows nothing, with no breadcrumb to escape by.
   * An empty tree is not evidence of that: it is what a load in progress looks like, so the check
   * waits for a tree with something in it.
   *
   * A root saved before Habit occurrences and a wait's derived nodes became rows (ADR 0008) names
   * the node by its old key; that one is re-rooted at the node's key now rather than lost.
   *
   * A folded run of Habit history, or a scope level of one, that is no longer drawn climbs to the
   * nearest thing that still is — the run, then the Habit's host — rather than all the way out.
   */
  useEffect(() => {
    if (subtreeRootId === null || tree.children.length === 0) return;
    if (path.length > 0) return;
    const migrated = migratedNodeId(tree, subtreeRootId);
    if (migrated !== undefined) { enterSubtree(migrated); return; }
    const fallback = fallbackRootFor(tree, subtreeRootId, reading);
    if (fallback !== null) enterSubtree(fallback);
    else onExitToRoot();
  }, [subtreeRootId, tree, path, reading, onExitToRoot, enterSubtree]);

  // Published only when it says something new. The walk is re-run whenever the fold's reading is
  // rebuilt, which hands back an equal chain in a new array — and publishing that would re-render
  // this hook's own view into another walk.
  useEffect(() => {
    const next = subtreeRootId === null ? null : { ancestors, currentTitle };
    if (sameSubtreeNav(publishedNav, next)) return;
    setSubtreeNav(next);
  }, [subtreeRootId, ancestors, currentTitle, publishedNav, setSubtreeNav]);

  const onExitSubtree = useCallback(() => exitSubtree(parentSubtreeId), [exitSubtree, parentSubtreeId]);

  return { subtreeRootId, parentSubtreeId, onExitSubtree, onExitToRoot };
}

/** Whether two published descriptors name the same chain, crumb for crumb. */
function sameSubtreeNav(a: SubtreeNav | null, b: SubtreeNav | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.currentTitle !== b.currentTitle || a.ancestors.length !== b.ancestors.length) return false;
  return a.ancestors.every((crumb, index) => {
    const other = b.ancestors[index];
    return other !== undefined && crumb.id === other.id && crumb.title === other.title;
  });
}

/** The two "go up" actions on their own, derived from the published descriptor rather than a tree. */
export interface SubtreeExits {
  subtreeRootId: string | null;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
}

/**
 * The subtree exits **without a tree**, for `ActiveTab` — which owns the global bindings and loads
 * no board of its own.
 *
 * `useSubtreeNav` above both *publishes* the descriptor (which needs the tree, to walk down to the
 * root and name every level above it) and consumes it. Only the publishing half needs the tree, so
 * a consumer that just wants the two exits reads the descriptor whichever view already published
 * it — exactly as the top bar's breadcrumb does. With no descriptor published there is no subtree
 * to leave, and the bindings are guarded on `subtreeRootId` anyway.
 */
export function useSubtreeExits(): SubtreeExits {
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const onExitToRoot = useMindmapStore((s) => s.exitToRoot);

  const ancestors = subtreeNav?.ancestors ?? [];
  const parentSubtreeId = ancestors[ancestors.length - 1]?.id ?? null;
  const onExitSubtree = useCallback(() => exitSubtree(parentSubtreeId), [exitSubtree, parentSubtreeId]);

  return { subtreeRootId, onExitSubtree, onExitToRoot };
}
