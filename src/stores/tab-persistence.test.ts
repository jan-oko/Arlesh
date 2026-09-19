import { beforeEach, describe, expect, it } from "vitest";
import { readPersistedTabs, parseTabState, TABS_STORAGE_KEY } from "./tab-persistence";
import { reloadTabs, useTabsStore } from "./use-tabs-store";
import { DEFAULT_TAB_STATE } from "./tab-stores";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
});

/** The zustand `persist` envelope every pre-tabs key was written in. */
function writeLegacy(key: string, state: unknown): void {
  localStorage.setItem(key, JSON.stringify({ state, version: 0 }));
}

describe("reading one tab's stored state", () => {
  it("backfills a mindmap filter saved before archivedMode existed", () => {
    // The shape a browser actually held before the Archived pill shipped. Left alone, `archivedMode`
    // came back `undefined` forever: the pill never changed and nothing was ever filtered by it.
    const state = parseTabState({
      subtreeRootId: null,
      view: { view: "mindmap", mindmapOrientation: "horizontal" },
      filter: {
        statusMode: "plan", modeIncludeFlows: true, tagFilters: [],
        showInfo: true, showFlow: true, privateMode: true,
      },
      listFilter: DEFAULT_LIST_FILTER,
    });

    expect(state.filter.archivedMode).toBe("inactive"); // backfilled, not undefined
    expect(state.filter.privateMode).toBe(true); // what was stored still wins
    expect(state.filter.statusMode).toBe("plan");
  });

  it("drops a Parent pill saved before the dimension was retired", () => {
    const state = parseTabState({
      listFilter: {
        preset: "all",
        pills: {
          parent: [{ value: "goal-1", mode: "any" }], dependency: [],
          taskStatus: [], goalStatus: [], projectStatus: [], scopeState: [], blocked: [],
        },
      },
    });

    // Not merely hidden: nothing is left narrowing the list that no chip shows and no control
    // clears — and nothing throws on the key either, since it is simply never read.
    expect(state.listFilter).toEqual(DEFAULT_LIST_FILTER);
  });

  it("keeps the pills that still exist while dropping the retired one", () => {
    const state = parseTabState({
      listFilter: {
        preset: "unblock",
        pills: {
          antecedent: [{ value: "aspect-1", mode: "any" }],
          parent: [{ value: "goal-1", mode: "any" }],
        },
      },
    });

    expect(state.listFilter.preset).toBe("unblock");
    expect(state.listFilter.pills)
      .toEqual({ ...DEFAULT_LIST_FILTER.pills, antecedent: [{ value: "aspect-1", mode: "any" }] });
  });

  it("falls back to the defaults for a tab whose stored state is missing or nonsense", () => {
    expect(parseTabState(undefined)).toEqual(DEFAULT_TAB_STATE);
    expect(parseTabState("not an object")).toEqual(DEFAULT_TAB_STATE);
    expect(parseTabState({ view: 7, filter: null, listFilter: [], subtreeRootId: 42 })).toEqual(DEFAULT_TAB_STATE);
  });
});

describe("reading the stored strip", () => {
  it("returns nothing when there is nothing stored", () => {
    localStorage.clear(); // the reload in `beforeEach` has already written the strip back down
    expect(readPersistedTabs()).toBeNull();
  });

  it("returns nothing for a blob that is not a strip at all", () => {
    localStorage.setItem(TABS_STORAGE_KEY, "{ broken");
    expect(readPersistedTabs()).toBeNull();
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: "some" }));
    expect(readPersistedTabs()).toBeNull();
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: [] }));
    expect(readPersistedTabs()).toBeNull();
  });

  it("skips a tab with no id and keeps the rest", () => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeTabId: "b",
      tabs: [{ title: "nameless" }, { id: "b", title: "CODE", state: DEFAULT_TAB_STATE }],
    }));

    const stored = readPersistedTabs();
    expect(stored?.tabs.map((tab) => tab.id)).toEqual(["b"]);
    expect(stored?.activeTabId).toBe("b");
  });

  it("falls back to the first tab when the stored active one is gone", () => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeTabId: "deleted",
      tabs: [{ id: "a", title: null, state: DEFAULT_TAB_STATE }],
    }));

    expect(readPersistedTabs()?.activeTabId).toBe("a");
  });
});

/**
 * The migration every existing user goes through exactly once. The blobs below are the real
 * pre-tabs keys, written in the shape the three old stores persisted them in — the assertion is
 * that opening the app after tabs land hands that session back as one tab, not a blank board.
 */
describe("a session saved before tabs existed", () => {
  beforeEach(() => {
    localStorage.clear();
    writeLegacy("arlesh-view", { view: "list", mindmapOrientation: "vertical", pathHeaderIcons: false });
    writeLegacy("arlesh-filter", {
      filter: { statusMode: "start", modeIncludeFlows: true, tagFilters: [{ tagId: 5, mode: "any" }], showInfo: true, showFlow: false, privateMode: true },
    });
    writeLegacy("arlesh-list-filter", {
      filter: {
        preset: "unblock",
        // A retired dimension beside a live one, as a real pre-tabs blob would carry it.
        pills: {
          parent: [{ value: "goal-1", mode: "all" }],
          antecedent: [{ value: "project-1", mode: "all" }],
        },
      },
    });
    reloadTabs();
  });

  it("comes back as exactly one tab", () => {
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("brings back the view and branch orientation it was left in", () => {
    const tab = useTabsStore.getState().tabs[0];
    expect(tab?.stores.view.getState()).toMatchObject({ view: "list", mindmapOrientation: "vertical" });
  });

  it("brings back the mindmap filter, including a field the old blob never had", () => {
    const filter = useTabsStore.getState().tabs[0]?.stores.filter.getState().filter;
    expect(filter?.statusMode).toBe("start");
    expect(filter?.tagFilters).toEqual([{ tagId: 5, mode: "any" }]);
    expect(filter?.privateMode).toBe(true);
    expect(filter?.archivedMode).toBe("inactive");
  });

  it("brings back the List View filter, with its pill map rebuilt to today's dimensions", () => {
    const listFilter = useTabsStore.getState().tabs[0]?.stores.listFilter.getState().filter;
    expect(listFilter?.preset).toBe("unblock");
    expect(listFilter?.pills)
      .toEqual({ ...DEFAULT_LIST_FILTER.pills, antecedent: [{ value: "project-1", mode: "all" }] });
  });

  it("starts at the whole tree, which is where a pre-tabs session always reopened", () => {
    expect(useTabsStore.getState().tabs[0]?.stores.mindmap.getState().subtreeRootId).toBeNull();
    expect(useTabsStore.getState().tabs[0]?.title).toBeNull();
  });
});

describe("a first run with nothing stored at all", () => {
  it("opens one default tab rather than an empty strip", () => {
    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.id).toBe(activeTabId);
    expect(tabs[0]?.stores.filter.getState().filter).toEqual(DEFAULT_FILTER);
  });
});

describe("a strip written by this build", () => {
  it("comes back with every tab's root, view and filters", () => {
    const first = useTabsStore.getState().tabs[0];
    first?.stores.mindmap.getState().enterSubtree("project-1");
    useTabsStore.getState().setTabTitle(first?.id ?? "", "CODE");
    const second = useTabsStore.getState().openTab();
    useTabsStore.getState().tabs[1]?.stores.filter.getState().setStatusMode("do");
    useTabsStore.getState().tabs[1]?.stores.view.getState().setView("list");

    reloadTabs();

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.title).toBe("CODE");
    expect(tabs[0]?.stores.mindmap.getState().subtreeRootId).toBe("project-1");
    expect(tabs[1]?.stores.filter.getState().filter.statusMode).toBe("do");
    expect(tabs[1]?.stores.view.getState().view).toBe("list");
    expect(activeTabId).toBe(second);
  });

  it("does not bring back the selection, collapsed nodes or canvas position", () => {
    const tab = useTabsStore.getState().tabs[0];
    tab?.stores.mindmap.getState().selectNode("task-1");
    tab?.stores.mindmap.getState().toggleCollapsed("goal-2");
    tab?.stores.panZoom.getState().setTransform({ x: 300, y: 50, scale: 2 });
    // A change that *is* persisted, so the strip is written down with the working state live.
    tab?.stores.view.getState().setView("list");

    reloadTabs();

    const restored = useTabsStore.getState().tabs[0];
    expect(restored?.stores.view.getState().view).toBe("list");
    expect(restored?.stores.mindmap.getState().selectedNodeId).toBeNull();
    expect(restored?.stores.mindmap.getState().collapsedNodeIds.size).toBe(0);
    expect(restored?.stores.panZoom.getState().transform).toBeNull();
  });
});

describe("a tab's name in storage", () => {
  it("comes back with the tab", () => {
    const id = useTabsStore.getState().tabs[0]?.id ?? "";
    useTabsStore.getState().setTabTitle(id, "CODE");
    useTabsStore.getState().renameTab(id, "Today");

    reloadTabs();

    expect(useTabsStore.getState().tabs[0]?.customTitle).toBe("Today");
    expect(useTabsStore.getState().tabs[0]?.title).toBe("CODE");
  });

  it("reads a strip written before tabs could be named as tabs with no names", () => {
    // Exactly the shape the key held before `customTitle` existed. Left unhandled it rehydrates as
    // `undefined`, which is neither a name nor the absence of one.
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", title: "CODE", state: { subtreeRootId: "project-1" } }],
    }));

    const stored = readPersistedTabs();

    expect(stored?.tabs[0]?.customTitle).toBeNull();
    expect(stored?.tabs[0]?.title).toBe("CODE");
  });

  it("gives a tab restored from that older strip its derived label", () => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", title: "CODE", state: { subtreeRootId: "project-1" } }],
    }));

    reloadTabs();

    expect(useTabsStore.getState().tabs[0]?.customTitle).toBeNull();
  });
});
