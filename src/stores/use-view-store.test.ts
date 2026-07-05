import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./use-view-store";

beforeEach(() => {
  useViewStore.setState({ view: "mindmap" });
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
