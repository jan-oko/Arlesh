import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./use-view-store";

beforeEach(() => {
  localStorage.clear();
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal", planScopeKind: "week" });
});

describe("setView", () => {
  it("sets the active view", () => {
    useViewStore.getState().setView("list");
    expect(useViewStore.getState().view).toBe("list");
  });
});

describe("setView", () => {
  it("reaches the Plan view from the List view in one call, with no cycle to walk", () => {
    useViewStore.getState().setView("list");
    useViewStore.getState().setView("plan");
    expect(useViewStore.getState().view).toBe("plan");
  });
});

describe("planScopeKind", () => {
  it("defaults to the week", () => {
    expect(useViewStore.getState().planScopeKind).toBe("week");
  });

  it("remembers the kind last filled", () => {
    useViewStore.getState().setPlanScopeKind("day");
    expect(useViewStore.getState().planScopeKind).toBe("day");
  });
});

describe("mindmapOrientation", () => {
  it("defaults to horizontal", () => {
    expect(useViewStore.getState().mindmapOrientation).toBe("horizontal");
  });

  it("toggles between horizontal and vertical", () => {
    useViewStore.getState().toggleMindmapOrientation();
    expect(useViewStore.getState().mindmapOrientation).toBe("vertical");
    useViewStore.getState().toggleMindmapOrientation();
    expect(useViewStore.getState().mindmapOrientation).toBe("horizontal");
  });
});
