import { beforeEach, describe, expect, it } from "vitest";
import { reloadTabs, useTabsStore } from "./use-tabs-store";
import { freshTabState } from "./tab-persistence";
import { activeTabStores } from "./tab-stores-context";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
});

/** Opens `count` extra tabs and hands back every tab id in strip order. */
function openTabs(count: number): string[] {
  for (let i = 0; i < count; i += 1) useTabsStore.getState().openTab();
  return useTabsStore.getState().tabs.map((tab) => tab.id);
}

describe("openTab", () => {
  it("opens the new tab beside the active one rather than at the end", () => {
    const [first] = openTabs(1);
    useTabsStore.getState().activateTab(first ?? "");
    const inserted = useTabsStore.getState().openTab();

    expect(useTabsStore.getState().tabs.map((tab) => tab.id)[1]).toBe(inserted);
  });

  it("activates what it opened", () => {
    const opened = useTabsStore.getState().openTab();
    expect(useTabsStore.getState().activeTabId).toBe(opened);
  });

  it("starts the tab where the caller said", () => {
    const opened = useTabsStore.getState().openTab(freshTabState("project-3"));
    const tab = useTabsStore.getState().tabs.find((t) => t.id === opened);
    expect(tab?.stores.mindmap.getState().subtreeRootId).toBe("project-3");
  });
});

describe("closeTab", () => {
  it("refuses to close the only tab, so the strip is never empty", () => {
    const only = useTabsStore.getState().tabs[0];
    expect(useTabsStore.getState().closeTab(only?.id ?? "")).toBe(false);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("hands the active tab's place to its right-hand neighbour", () => {
    const ids = openTabs(2);
    useTabsStore.getState().activateTab(ids[1] ?? "");

    useTabsStore.getState().closeTab(ids[1] ?? "");

    expect(useTabsStore.getState().activeTabId).toBe(ids[2]);
  });

  it("falls back to the new last tab when the rightmost one is closed", () => {
    const ids = openTabs(1);
    useTabsStore.getState().activateTab(ids[1] ?? "");

    useTabsStore.getState().closeTab(ids[1] ?? "");

    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);
  });

  it("leaves the active tab alone when a different one is closed", () => {
    const ids = openTabs(2);
    useTabsStore.getState().activateTab(ids[0] ?? "");

    useTabsStore.getState().closeTab(ids[2] ?? "");

    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("does nothing for a tab that is not open", () => {
    openTabs(1);
    expect(useTabsStore.getState().closeTab("never-opened")).toBe(false);
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });
});

describe("cycleTab", () => {
  it("moves forward and wraps round the end", () => {
    const ids = openTabs(2);
    useTabsStore.getState().activateTab(ids[2] ?? "");

    useTabsStore.getState().cycleTab(1);

    expect(useTabsStore.getState().activeTabId).toBe(ids[0]);
  });

  it("moves backward and wraps round the start", () => {
    const ids = openTabs(2);
    useTabsStore.getState().activateTab(ids[0] ?? "");

    useTabsStore.getState().cycleTab(-1);

    expect(useTabsStore.getState().activeTabId).toBe(ids[2]);
  });
});

describe("activateAt", () => {
  it("jumps to a tab by position", () => {
    const ids = openTabs(2);
    useTabsStore.getState().activateAt(1);
    expect(useTabsStore.getState().activeTabId).toBe(ids[1]);
  });

  it("does nothing for a position past the end", () => {
    const ids = openTabs(1);
    useTabsStore.getState().activateAt(8);
    expect(useTabsStore.getState().activeTabId).toBe(ids[1]);
  });
});

describe("moveTab", () => {
  it("reorders the strip", () => {
    const ids = openTabs(2);
    useTabsStore.getState().moveTab(0, 2);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("ignores a drop that goes nowhere or off the strip", () => {
    const ids = openTabs(1);
    useTabsStore.getState().moveTab(1, 1);
    useTabsStore.getState().moveTab(0, 5);
    useTabsStore.getState().moveTab(4, 0);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(ids);
  });
});

describe("the active tab's stores", () => {
  it("are the ones the provider-less readers see, and follow activation", () => {
    const ids = openTabs(1);
    useTabsStore.getState().activateTab(ids[0] ?? "");
    expect(activeTabStores()).toBe(useTabsStore.getState().tabs[0]?.stores);

    useTabsStore.getState().activateTab(ids[1] ?? "");

    expect(activeTabStores()).toBe(useTabsStore.getState().tabs[1]?.stores);
  });
});

describe("setTabTitle", () => {
  it("renames a tab", () => {
    const only = useTabsStore.getState().tabs[0];
    useTabsStore.getState().setTabTitle(only?.id ?? "", "Bugfixes");
    expect(useTabsStore.getState().tabs[0]?.title).toBe("Bugfixes");
  });

  it("leaves the strip alone when the label has not changed", () => {
    const before = useTabsStore.getState().tabs;
    useTabsStore.getState().setTabTitle(before[0]?.id ?? "", null);
    expect(useTabsStore.getState().tabs).toBe(before);
  });
});

describe("renameTab", () => {
  it("gives a tab a name of its own", () => {
    const only = useTabsStore.getState().tabs[0];
    useTabsStore.getState().renameTab(only?.id ?? "", "Today");
    expect(useTabsStore.getState().tabs[0]?.customTitle).toBe("Today");
  });

  it("trims what was typed, so a stray space is not a different name", () => {
    const only = useTabsStore.getState().tabs[0];
    useTabsStore.getState().renameTab(only?.id ?? "", "  Today  ");
    expect(useTabsStore.getState().tabs[0]?.customTitle).toBe("Today");
  });

  it("takes the name off when given a blank one, which is the way back to the derived label", () => {
    const id = useTabsStore.getState().tabs[0]?.id ?? "";
    useTabsStore.getState().renameTab(id, "Today");

    useTabsStore.getState().renameTab(id, "   ");

    expect(useTabsStore.getState().tabs[0]?.customTitle).toBeNull();
  });

  it("leaves the strip alone when the name has not changed", () => {
    const id = useTabsStore.getState().tabs[0]?.id ?? "";
    useTabsStore.getState().renameTab(id, "Today");
    const before = useTabsStore.getState().tabs;

    useTabsStore.getState().renameTab(id, "Today");

    expect(useTabsStore.getState().tabs).toBe(before);
  });

  it("keeps the name when navigating republishes the derived label", () => {
    // The trap: the label is rewritten from the subtree descriptor on every navigation, so a name
    // stored *in* it would be wiped the next time the tab moved — silently, and only then.
    const id = useTabsStore.getState().tabs[0]?.id ?? "";
    useTabsStore.getState().setTabTitle(id, "CODE");
    useTabsStore.getState().renameTab(id, "Today");

    useTabsStore.getState().setTabTitle(id, "Bugfixes");

    expect(useTabsStore.getState().tabs[0]?.customTitle).toBe("Today");
    expect(useTabsStore.getState().tabs[0]?.title).toBe("Bugfixes");
  });

  it("reveals the label the tab has navigated to, not the one it had when it was named", () => {
    const id = useTabsStore.getState().tabs[0]?.id ?? "";
    useTabsStore.getState().setTabTitle(id, "CODE");
    useTabsStore.getState().renameTab(id, "Today");
    useTabsStore.getState().setTabTitle(id, "Bugfixes");

    useTabsStore.getState().renameTab(id, "");

    expect(useTabsStore.getState().tabs[0]?.customTitle).toBeNull();
    expect(useTabsStore.getState().tabs[0]?.title).toBe("Bugfixes");
  });
});
