import { describe, expect, it } from "vitest";
import type { Binding, BindingMeta } from "@/utils/hotkeys/chord";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import { TAB_BINDINGS } from "@/utils/hotkeys/tab-bindings";
import { MINDMAP_BINDINGS } from "@/utils/hotkeys/mindmap-bindings";
import { LIST_BINDINGS } from "@/utils/hotkeys/list-bindings";
import { PLAN_BINDINGS } from "@/utils/hotkeys/plan-bindings";
import { STEPS_BINDINGS } from "@/utils/hotkeys/steps-bindings";
import { ZEN_BINDINGS } from "@/utils/hotkeys/zen-bindings";
import {
  PALETTE_EXCLUSIONS, PALETTE_FAMILIES, isReachableByTouch, paletteEntries, replacingGesture,
} from "./palette";

/** Every table in the registry, as the keyboard dispatches them. */
const TABLES: ReadonlyArray<readonly BindingMeta[]> = [
  GLOBAL_BINDINGS, TAB_BINDINGS, MINDMAP_BINDINGS, LIST_BINDINGS, PLAN_BINDINGS, STEPS_BINDINGS, ZEN_BINDINGS,
];
const ALL: readonly BindingMeta[] = TABLES.flat();

/** A table as the command surface would publish it, with every guard passing. */
function asCommands(table: readonly BindingMeta[]): SurfaceCommand[] {
  return table.map((binding) => ({
    id: binding.id,
    chord: binding.chord,
    label: { namespace: "hotkeys", key: binding.labelKey },
    section: binding.section,
    group: binding.group ?? null,
    hidden: binding.hidden === true,
    canRun: () => true,
    run: () => undefined,
  }));
}

/** Whether `binding` has a palette row: its own, or the one its action collapses into. */
function hasPaletteRow(binding: BindingMeta, rows: readonly SurfaceCommand[]): boolean {
  return rows.some((row) => row.id === binding.id ||
    (row.section === binding.section && row.label.key === binding.labelKey && !binding.id.startsWith("planView.subscope.")));
}

describe("palette coverage: no binding is lost without a keyboard", () => {
  it.each(TABLES.map((table, index) => [index, table] as const))("table %i: every binding has a palette row or a gesture", (_index, table) => {
    const rows = paletteEntries(asCommands(table), { showTabs: true });
    const lost = table.filter((binding) => replacingGesture(binding.id) === null && !hasPaletteRow(binding, rows))
      .map((binding) => binding.id);
    expect(lost).toEqual([]);
  });

  it("every hidden binding is an alias of a visible one, or a member of a palette family", () => {
    for (const table of TABLES) {
      const unreachable = table.filter((binding) => !isReachableByTouch(binding, table)).map((binding) => binding.id);
      expect(unreachable).toEqual([]);
    }
  });

  it("every exclusion and family still names a binding, so none outlives what it excused", () => {
    const stale = [...PALETTE_EXCLUSIONS.map((exclusion) => exclusion.idPattern), ...PALETTE_FAMILIES]
      .filter((pattern) => !ALL.some((binding) => (pattern.endsWith(".") ? binding.id.startsWith(pattern) : binding.id === pattern)));
    expect(stale).toEqual([]);
  });

  it("a binding added to a table appears in the palette with no other change", () => {
    const added: Binding<unknown> = {
      id: "listView.somethingNew", section: "listView", chord: { code: "KeyX", ctrl: true, alt: true },
      labelKey: "undo", run: () => undefined,
    };
    const rows = paletteEntries(asCommands([added]), { showTabs: true });
    expect(rows.map((row) => row.id)).toEqual(["listView.somethingNew"]);
  });
});
