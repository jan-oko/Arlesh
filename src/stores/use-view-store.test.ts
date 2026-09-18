import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./use-view-store";

beforeEach(() => {
  localStorage.clear();
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal", pathHeaderIcons: true });
});

describe("setView", () => {
  it("sets the active view", () => {
    useViewStore.getState().setView("list");
    expect(useViewStore.getState().view).toBe("list");
  });
});

describe("toggleView", () => {
  it("toggles between mindmap and list", () => {
    useViewStore.getState().toggleView();
    expect(useViewStore.getState().view).toBe("list");
    useViewStore.getState().toggleView();
    expect(useViewStore.getState().view).toBe("mindmap");
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

describe("pathHeaderIcons", () => {
  it("defaults to on, the behaviour the path header shipped with", () => {
    expect(useViewStore.getState().pathHeaderIcons).toBe(true);
  });

  it("toggles off and back on", () => {
    useViewStore.getState().togglePathHeaderIcons();
    expect(useViewStore.getState().pathHeaderIcons).toBe(false);
    useViewStore.getState().togglePathHeaderIcons();
    expect(useViewStore.getState().pathHeaderIcons).toBe(true);
  });
});

describe("rehydrating display preferences saved by an older build", () => {
  it("gives a blob saved before path-header glyphs existed the default rather than undefined", async () => {
    // A real pre-toggle blob: this store persists its whole state, so it holds exactly these keys.
    localStorage.setItem(
      "arlesh-view",
      JSON.stringify({ state: { view: "list", mindmapOrientation: "vertical" }, version: 0 }),
    );
    // Rehydration merges onto the initializer's state, so a fresh boot is the premise here.
    await useViewStore.persist.rehydrate();
    // Preferences here are top-level fields, so zustand's shallow merge leaves the missing one at
    // its default instead of blanking it — the failure mode mergePersistedFilterSlice guards against
    // in the filter stores, which nest theirs under a `filter` slice the same merge replaces whole.
    expect(useViewStore.getState().pathHeaderIcons).toBe(true);
    expect(useViewStore.getState().view).toBe("list");
    expect(useViewStore.getState().mindmapOrientation).toBe("vertical");
  });
});
