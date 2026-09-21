import { describe, expect, it } from "vitest";
import { createTabStores, readTabState, DEFAULT_TAB_STATE } from "./tab-stores";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

/**
 * The store factory is the point of the whole design, and leakage between tabs is the failure it
 * exists to rule out. Every test here changes one tab and asserts the other did not move.
 */
describe("two tabs' stores", () => {
  it("hold different mindmap filters", () => {
    const a = createTabStores();
    const b = createTabStores();

    a.filter.getState().setStatusMode("do");

    expect(a.filter.getState().filter.statusMode).toBe("do");
    expect(b.filter.getState().filter.statusMode).toBe(DEFAULT_FILTER.statusMode);
  });

  it("hold different List View filters", () => {
    const a = createTabStores();
    const b = createTabStores();

    a.listFilter.getState().addPill("taskStatus", "todo");
    a.listFilter.getState().setPreset("unblock");

    expect(a.listFilter.getState().filter.pills.taskStatus).toEqual([{ value: "todo", mode: "any" }]);
    expect(b.listFilter.getState().filter).toEqual(DEFAULT_LIST_FILTER);
  });

  it("hold different subtree roots, so exiting one subtree does not move another tab", () => {
    const a = createTabStores();
    const b = createTabStores();
    a.mindmap.getState().enterSubtree("project-1");
    b.mindmap.getState().enterSubtree("goal-9");

    a.mindmap.getState().exitToRoot();

    expect(a.mindmap.getState().subtreeRootId).toBeNull();
    expect(b.mindmap.getState().subtreeRootId).toBe("goal-9");
  });

  it("hold different views and branch orientations", () => {
    const a = createTabStores();
    const b = createTabStores();

    a.view.getState().setView("list");
    a.view.getState().toggleMindmapOrientation();

    expect(a.view.getState()).toMatchObject({ view: "list", mindmapOrientation: "vertical" });
    expect(b.view.getState()).toMatchObject({ view: "mindmap", mindmapOrientation: "horizontal" });
  });

  it("hold different selections and collapsed nodes", () => {
    const a = createTabStores();
    const b = createTabStores();

    a.mindmap.getState().selectNode("task-1");
    a.mindmap.getState().toggleCollapsed("goal-2");

    expect(b.mindmap.getState().selectedNodeId).toBeNull();
    expect(b.mindmap.getState().collapsedNodeIds.has("goal-2")).toBe(false);
  });

  it("hold different canvas positions", () => {
    const a = createTabStores();
    const b = createTabStores();

    a.panZoom.getState().setTransform({ x: 120, y: -40, scale: 2 });

    expect(a.panZoom.getState().transform).toEqual({ x: 120, y: -40, scale: 2 });
    expect(b.panZoom.getState().transform).toBeNull();
  });
});

describe("seeding a tab", () => {
  it("starts it where the restored state says, rather than at the defaults", () => {
    const stores = createTabStores({
      subtreeRootId: "project-7",
      view: { view: "list", mindmapOrientation: "vertical" },
      filter: { ...DEFAULT_FILTER, statusMode: "start" },
      listFilter: { ...DEFAULT_LIST_FILTER, preset: "unblock" },
      expandedHabitGroupIds: ["habitrun-4-virtual"],
    });

    expect(stores.mindmap.getState().subtreeRootId).toBe("project-7");
    expect(stores.view.getState().view).toBe("list");
    expect(stores.filter.getState().filter.statusMode).toBe("start");
    expect(stores.listFilter.getState().filter.preset).toBe("unblock");
    expect(stores.mindmap.getState().expandedHabitGroupIds).toEqual(new Set(["habitrun-4-virtual"]));
  });
});

describe("readTabState", () => {
  it("reads back exactly what was put in", () => {
    const stores = createTabStores();
    expect(readTabState(stores)).toEqual(DEFAULT_TAB_STATE);
  });

  it("leaves out the working state a restart should not restore", () => {
    const stores = createTabStores();
    stores.mindmap.getState().selectNode("task-1");
    stores.mindmap.getState().toggleCollapsed("goal-2");
    stores.panZoom.getState().setTransform({ x: 5, y: 5, scale: 3 });

    expect(readTabState(stores)).toEqual(DEFAULT_TAB_STATE);
  });

  it("keeps no habit group a recursive collapse shut, so the two presses cancel out", () => {
    // The fold's openings are the one part of this that is written down, so a recursive collapse
    // that forgot to take them back out again would persist an expansion the board is not showing.
    const stores = createTabStores();
    const mindmap = stores.mindmap.getState();
    mindmap.expandSubtree(new Set(["goal-5"]), new Set(["habitrun-7-virtual", "habitrun-7-week-2026-09-06-virtual"]));

    mindmap.collapseSubtree(new Set(["goal-5"]), new Set(["habitrun-7-virtual", "habitrun-7-week-2026-09-06-virtual"]));

    expect(readTabState(stores)).toEqual(DEFAULT_TAB_STATE);
  });
});
