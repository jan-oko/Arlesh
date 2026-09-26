import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDisplayStore } from "./use-display-store";

beforeEach(() => {
  // Reset before clearing: the persist middleware writes the key back on every set, so clearing
  // first would leave a stored value behind for the boot-from-scratch cases below.
  useDisplayStore.setState({
    habitCollapseThreshold: 3, asynchronousFirst: false,
    planCandidatesPathGrouping: true, planCandidatesParentOnly: true,
    planSplitBySubscope: false, planIncludePremorning: false,
  });
  localStorage.clear();
});

/**
 * The path-header glyphs and their *Path icons* switch are gone, and a stored blob written while
 * they existed is still on disk for anyone who had the app open before. Reading one must leave
 * every other display preference exactly as it was found rather than tripping over a key this
 * store no longer knows about.
 */
describe("a display blob written while the path-icon setting still existed", () => {
  /** Boots the store from scratch, which is the only moment it reads what was stored. */
  async function bootDisplayStore() {
    vi.resetModules();
    const module = await import("./use-display-store");
    return module.useDisplayStore;
  }

  it("loads, keeping the preferences that remain", async () => {
    localStorage.setItem(
      "arlesh-display",
      JSON.stringify({
        state: { pathHeaderIcons: false, habitCollapseThreshold: 7, asynchronousFirst: true },
        version: 0,
      }),
    );

    const store = await bootDisplayStore();

    expect(store.getState().habitCollapseThreshold).toBe(7);
    expect(store.getState().asynchronousFirst).toBe(true);
  });

  it("ignores the pre-tabs key the setting used to be carried across from", async () => {
    localStorage.setItem(
      "arlesh-view",
      JSON.stringify({ state: { view: "list", mindmapOrientation: "vertical", pathHeaderIcons: false }, version: 0 }),
    );

    const store = await bootDisplayStore();

    expect(store.getState().habitCollapseThreshold).toBe(3);
    expect(store.getState().asynchronousFirst).toBe(false);
  });
});

/**
 * The Plan View's path switch was `planPathGrouping` and defaulted off. It is now the candidates
 * pane's alone and defaults **on** — which a rename is what makes true, since `persist` merges
 * whatever it finds over the initial state and what it would have found is an off switch nobody
 * chose.
 */
describe("a display blob carrying the split switch from when it defaulted off", () => {
  it("ignores it, so the planned pane opens split", async () => {
    localStorage.setItem(
      "arlesh-display",
      JSON.stringify({ state: { planSubscopeSplit: false }, version: 0 }),
    );
    vi.resetModules();

    const module = await import("./use-display-store");

    expect(module.useDisplayStore.getState().planSplitBySubscope).toBe(true);
  });

  it("keeps a choice made under the new name", async () => {
    localStorage.setItem(
      "arlesh-display",
      JSON.stringify({ state: { planSplitBySubscope: false }, version: 0 }),
    );
    vi.resetModules();

    const module = await import("./use-display-store");

    expect(module.useDisplayStore.getState().planSplitBySubscope).toBe(false);
  });
});

describe("a display blob carrying the Plan View's first path switch", () => {
  it("ignores it, so the new switch actually opens on", async () => {
    localStorage.setItem(
      "arlesh-display",
      JSON.stringify({ state: { planPathGrouping: false }, version: 0 }),
    );
    vi.resetModules();

    const module = await import("./use-display-store");

    expect(module.useDisplayStore.getState().planCandidatesPathGrouping).toBe(true);
  });
});

describe("the Plan View's kebab switches", () => {
  it("open a pass on what still needs placing, grouped by where it lives", () => {
    expect(useDisplayStore.getState().planCandidatesParentOnly).toBe(true);
    expect(useDisplayStore.getState().planCandidatesPathGrouping).toBe(true);
  });

  it("split the planned pane by subscope, and leave Premorning out of it", async () => {
    // The shared `beforeEach` pins the switches; the default is what a fresh store boots with.
    localStorage.clear();
    vi.resetModules();
    const module = await import("./use-display-store");
    expect(module.useDisplayStore.getState().planSplitBySubscope).toBe(true);
    expect(useDisplayStore.getState().planIncludePremorning).toBe(false);
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
