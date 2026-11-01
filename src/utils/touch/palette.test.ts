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

  it("leaves out a second key for the same action, listing the action once", () => {
    const rows = paletteEntries([command("mindmap.zoomIn"), command("mindmap.zoomInNumpad")], { showTabs: true });
    expect(rows.map((row) => row.id)).toEqual(["mindmap.zoomIn"]);
  });

  it("says which way a pair of opposites goes, where the cheat-sheet's one line names both", () => {
    const rows = paletteEntries([command("planView.previousScope"), command("planView.nextScope")], { showTabs: true });
    expect(rows.map((row) => row.label)).toEqual([
      { namespace: "touch", key: "palettePreviousScope" },
      { namespace: "touch", key: "paletteNextScope" },
    ]);
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
