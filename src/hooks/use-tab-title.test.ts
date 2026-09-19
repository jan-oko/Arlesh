import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTabTitle } from "./use-tab-title";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
});

function activeTitle(): string | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  return tabs.find((tab) => tab.id === activeTabId)?.title ?? null;
}

describe("a tab's label", () => {
  it("is empty for a tab showing the whole tree, so the strip can name it itself", () => {
    renderHook(() => useTabTitle());
    expect(activeTitle()).toBeNull();
  });

  it("takes the title of the subtree the tab is rooted at", () => {
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    renderHook(() => useTabTitle());

    act(() => {
      useMindmapStore.setState({
        subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Arlesh", parentSubtreeId: null },
      });
    });

    expect(activeTitle()).toBe("CODE");
  });

  it("clears back to the whole-tree label on leaving the subtree", () => {
    useMindmapStore.setState({
      subtreeRootId: "project-1",
      subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Arlesh", parentSubtreeId: null },
    });
    renderHook(() => useTabTitle());
    expect(activeTitle()).toBe("CODE");

    act(() => { useMindmapStore.getState().exitToRoot(); });

    expect(activeTitle()).toBeNull();
  });

  it("keeps the stored label while the view has not resolved the subtree yet", () => {
    const active = useTabsStore.getState().activeTabId;
    useTabsStore.getState().setTabTitle(active, "CODE");
    useMindmapStore.setState({ subtreeRootId: "project-1", subtreeNav: null });

    renderHook(() => useTabTitle());

    expect(activeTitle()).toBe("CODE");
  });
});

describe("a tab that has been given a name", () => {
  function activeCustomTitle(): string | null {
    const { tabs, activeTabId } = useTabsStore.getState();
    return tabs.find((tab) => tab.id === activeTabId)?.customTitle ?? null;
  }

  it("keeps it while the derived label goes on tracking where the tab is", () => {
    // The two are separate fields precisely so this effect — which runs on every navigation — can
    // keep writing the label without ever touching the name.
    const active = useTabsStore.getState().activeTabId;
    useTabsStore.getState().renameTab(active, "Today");
    useMindmapStore.setState({ subtreeRootId: "project-1" });
    renderHook(() => useTabTitle());

    act(() => {
      useMindmapStore.setState({
        subtreeNav: { currentTitle: "CODE", rootTitle: "Arlesh", parentTitle: "Arlesh", parentSubtreeId: null },
      });
    });

    expect(activeCustomTitle()).toBe("Today");
    expect(activeTitle()).toBe("CODE");
  });
});
