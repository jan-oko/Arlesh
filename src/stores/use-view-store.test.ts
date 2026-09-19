import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./use-view-store";

beforeEach(() => {
  localStorage.clear();
  useViewStore.setState({ view: "mindmap", mindmapOrientation: "horizontal" });
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
