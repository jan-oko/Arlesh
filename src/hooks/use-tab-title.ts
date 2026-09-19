import { useEffect } from "react";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useTabsStore } from "@/stores/use-tabs-store";

/**
 * Keeps the active tab's label in step with the subtree it is rooted at.
 *
 * The strip holds no tree, and an inactive tab has no view mounted to resolve one, so the label is
 * stored with the tab rather than looked up. Whichever view is on screen publishes the subtree
 * descriptor already (`use-subtree-nav`), so a tab's label is refreshed — and a rename picked up —
 * the moment that tab is visited.
 */
export function useTabTitle(): void {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const subtreeRootId = useMindmapStore((s) => s.subtreeRootId);
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);

  useEffect(() => {
    if (subtreeRootId === null) {
      setTabTitle(activeTabId, null);
      return;
    }
    // Before the view has resolved the descriptor the stored label is the better answer: dropping
    // it would blank the tab for a frame on every load.
    if (subtreeNav === null || subtreeNav.currentTitle === "") return;
    setTabTitle(activeTabId, subtreeNav.currentTitle);
  }, [activeTabId, subtreeRootId, subtreeNav, setTabTitle]);
}
