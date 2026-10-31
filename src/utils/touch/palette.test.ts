import { describe, expect, it } from "vitest";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { paletteEntries } from "./palette";

function command(id: string, overrides: Partial<SurfaceCommand> = {}): SurfaceCommand {
  return {
    id,
    chord: { code: "KeyA" },
    label: { namespace: "hotkeys", key: "undo" },
    section: "listView",
    group: null,
    hidden: false,
    canRun: () => true,
    run: () => undefined,
    ...overrides,
  };
}

describe("paletteEntries", () => {
  it("leaves out a command whose guard does not pass", () => {
    const rows = paletteEntries([command("listView.undo", { canRun: () => false })], { showTabs: true });
    expect(rows).toEqual([]);
  });

  it("leaves out a hidden alias", () => {
    const rows = paletteEntries([command("listView.redoAlias", { hidden: true })], { showTabs: true });
    expect(rows).toEqual([]);
  });

  it("leaves out the arrow keys, which a tap replaces", () => {
    const rows = paletteEntries([command("listView.navigateUp")], { showTabs: true });
    expect(rows).toEqual([]);
  });

  it("collapses two commands with the same words into the first that can act", () => {
    const rows = paletteEntries([
      command("stepsView.zoomIn", { canRun: () => false, label: { namespace: "hotkeys", key: "zoomIn" } }),
      command("stepsView.zoomInOther", { label: { namespace: "hotkeys", key: "zoomIn" } }),
    ], { showTabs: true });
    expect(rows.map((row) => row.id)).toEqual(["stepsView.zoomInOther"]);
  });

  it("lists each hidden member of a family that can act — the Plan View's buckets", () => {
    const label = { namespace: "hotkeys", key: "planSubscopeNumber" } as const;
    const rows = paletteEntries([
      command("planView.subscope.1", { label, section: "planView" }),
      command("planView.subscope.2", { label, section: "planView", hidden: true }),
      command("planView.subscope.3", { label, section: "planView", hidden: true, canRun: () => false }),
    ], { showTabs: true });
    expect(rows.map((row) => row.id)).toEqual(["planView.subscope.1", "planView.subscope.2"]);
  });

  it("leaves the tab chords out where the tab strip is not drawn", () => {
    const rows = paletteEntries([command("tabs.open", { section: "tabs" })], { showTabs: false });
    expect(rows).toEqual([]);
  });
});
