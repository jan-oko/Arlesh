import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TabStrip from "./TabStrip";
import TopBar from "@/components/TopBar/TopBar";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { TabStoresContext } from "@/stores/tab-stores-context";
import { freshTabState } from "@/stores/tab-persistence";
import { useFilterDisplay } from "@/hooks/use-filter-display";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-filter-display");

vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi());

const mockUseFilterDisplay = vi.mocked(useFilterDisplay);

const EMPTY_DISPLAY = {
  tagOptions: [], tagName: (id: number) => `#${id}`, tagColor: () => null,
  nodeLabel: (ref: string) => ref, nodeColor: () => null,
  antecedentPool: [], dependencyPool: [],
  displayTaskStatus: (v: string) => v, displayGoalStatus: (v: string) => v,
  displayProjectStatus: (v: string) => v, displayVerdict: (v: string) => v,
  displayScopeState: (v: string) => v, displayAgentic: (v: string) => v, displayBlocked: (v: string) => v,
  displayAsynchronous: (v: string) => v,
};

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  mockUseFilterDisplay.mockReturnValue(EMPTY_DISPLAY);
});

/**
 * The strip plus the active tab's controls, wired the way the app wires them: the top bar renders
 * under the active tab's store provider, so it reads that tab and nothing else.
 */
function Harness() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const active = tabs.find((tab) => tab.id === activeTabId);
  return (
    <>
      <TabStrip />
      {active !== undefined && (
        <TabStoresContext.Provider value={active.stores}>
          <TopBar />
        </TabStoresContext.Provider>
      )}
    </>
  );
}

function switchTo(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** The preset control is the app's own listbox, not a native select: open it, then pick. */
function choosePreset(preset: string): void {
  fireEvent.click(screen.getByRole("button", { name: "listView:statusPresetLabel" }));
  fireEvent.click(screen.getByRole("option", { name: `listView:preset.${preset}` }));
}

function shownPreset(): string {
  return screen.getByRole("button", { name: "listView:statusPresetLabel" }).textContent ?? "";
}

describe("two tabs sharing one top bar", () => {
  beforeEach(() => {
    const second = useTabsStore.getState().openTab(freshTabState("project-1"));
    useTabsStore.getState().setTabTitle(second, "CODE");
    useTabsStore.getState().activateAt(0);
  });

  it("shows the active tab's status preset, and switching swaps it", () => {
    render(<Harness />);
    choosePreset("do");
    expect(shownPreset()).toContain("listView:preset.do");

    switchTo("CODE");

    // The second tab was never touched, so it is still on its own preset.
    expect(shownPreset()).toContain("listView:preset.all");
  });

  it("brings a tab's preset back when you switch away and return", () => {
    render(<Harness />);
    choosePreset("start");

    switchTo("CODE");
    switchTo("common:tabWholeTree");

    expect(shownPreset()).toContain("listView:preset.start");
  });

  it("shows the subtree breadcrumb only for the tab that is inside one", () => {
    useTabsStore.getState().tabs[1]?.stores.mindmap.getState().setSubtreeNav({
      ancestors: [{ id: null, title: "Arlesh" }], currentTitle: "CODE",
    });
    render(<Harness />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    switchTo("CODE");

    expect(screen.getByRole("navigation", { name: "insideSubtree" })).toBeInTheDocument();
  });

  it("leaves the other tab where it was when one exits its subtree", () => {
    const [first, second] = useTabsStore.getState().tabs;
    first?.stores.mindmap.getState().enterSubtree("goal-9");
    second?.stores.mindmap.getState().setSubtreeNav({
      ancestors: [{ id: null, title: "Arlesh" }], currentTitle: "CODE",
    });
    render(<Harness />);

    switchTo("CODE");
    fireEvent.click(screen.getByRole("button", { name: /Arlesh/ }));

    expect(second?.stores.mindmap.getState().subtreeRootId).toBeNull();
    expect(first?.stores.mindmap.getState().subtreeRootId).toBe("goal-9");
  });

  it("switches the view with the tab, so a list stays a list", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "common:viewList" }));

    switchTo("CODE");
    expect(useTabsStore.getState().tabs[1]?.stores.view.getState().view).toBe("mindmap");

    switchTo("common:tabWholeTree");
    expect(useTabsStore.getState().tabs[0]?.stores.view.getState().view).toBe("list");
  });
});
