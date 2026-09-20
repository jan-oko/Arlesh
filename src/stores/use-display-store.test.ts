import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDisplayStore } from "./use-display-store";

beforeEach(() => {
  // Reset before clearing: the persist middleware writes the key back on every set, so clearing
  // first would leave a stored value behind for the boot-from-scratch cases below.
  useDisplayStore.setState({ pathHeaderIcons: true, habitCollapseThreshold: 3 });
  localStorage.clear();
});

describe("pathHeaderIcons", () => {
  it("defaults to on, the behaviour the path header shipped with", () => {
    expect(useDisplayStore.getState().pathHeaderIcons).toBe(true);
  });

  it("toggles off and back on", () => {
    useDisplayStore.getState().togglePathHeaderIcons();
    expect(useDisplayStore.getState().pathHeaderIcons).toBe(false);
    useDisplayStore.getState().togglePathHeaderIcons();
    expect(useDisplayStore.getState().pathHeaderIcons).toBe(true);
  });
});

/**
 * The preference used to live in the view store, which tabs made per-tab. Moving it out has to
 * carry the existing choice with it, or turning tabs on silently switches the glyphs back on for
 * everyone who had turned them off.
 */
describe("a path-icon choice made before tabs existed", () => {
  /** Boots the store from scratch, which is the only moment it reads the pre-tabs key. */
  async function bootDisplayStore() {
    vi.resetModules();
    const module = await import("./use-display-store");
    return module.useDisplayStore;
  }

  it("carries an explicit 'off' across", async () => {
    // A real pre-tabs `arlesh-view` blob: that store persisted its whole state under one key.
    localStorage.setItem(
      "arlesh-view",
      JSON.stringify({ state: { view: "list", mindmapOrientation: "vertical", pathHeaderIcons: false }, version: 0 }),
    );

    const store = await bootDisplayStore();

    expect(store.getState().pathHeaderIcons).toBe(false);
  });

  it("defaults to on for a blob written before the preference existed at all", async () => {
    localStorage.setItem(
      "arlesh-view",
      JSON.stringify({ state: { view: "mindmap", mindmapOrientation: "horizontal" }, version: 0 }),
    );

    const store = await bootDisplayStore();

    expect(store.getState().pathHeaderIcons).toBe(true);
  });

  it("prefers its own stored value once there is one", async () => {
    localStorage.setItem("arlesh-view", JSON.stringify({ state: { pathHeaderIcons: false }, version: 0 }));
    localStorage.setItem("arlesh-display", JSON.stringify({ state: { pathHeaderIcons: true }, version: 0 }));

    const store = await bootDisplayStore();

    expect(store.getState().pathHeaderIcons).toBe(true);
  });
});

describe("the habit-history collapse threshold", () => {
  it("starts at three", () => {
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(3);
  });

  it("holds a chosen threshold", () => {
    useDisplayStore.getState().setHabitCollapseThreshold(8);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(8);
  });

  it("refuses a threshold below two, and one far above anything useful", () => {
    useDisplayStore.getState().setHabitCollapseThreshold(1);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(2);

    useDisplayStore.getState().setHabitCollapseThreshold(5000);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(99);
  });

  it("rounds a fractional threshold rather than folding on half an iteration", () => {
    useDisplayStore.getState().setHabitCollapseThreshold(4.6);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(5);
  });

  it("falls back to the default when handed something that is not a number", () => {
    useDisplayStore.getState().setHabitCollapseThreshold(Number.NaN);
    expect(useDisplayStore.getState().habitCollapseThreshold).toBe(3);
  });

  it("comes back as it was left", async () => {
    localStorage.setItem(
      "arlesh-display",
      JSON.stringify({ state: { habitCollapseThreshold: 12 }, version: 0 }),
    );
    vi.resetModules();

    const module = await import("./use-display-store");

    expect(module.useDisplayStore.getState().habitCollapseThreshold).toBe(12);
  });
});
