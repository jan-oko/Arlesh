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
  PALETTE_ALIASES, PALETTE_EXCLUSIONS, PALETTE_FAMILIES, PALETTE_LABELS, isAlias, isFamilyMember, isReachableByTouch, paletteEntries, replacingGesture,
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

/** Whether `binding` has a palette row of its own, or is an alias of a binding that has one. */
function hasPaletteRow(binding: BindingMeta, table: readonly BindingMeta[], rows: readonly SurfaceCommand[]): boolean {
  if (rows.some((row) => row.id === binding.id)) return true;
  return isAlias(binding) && table.some((other) =>
    other.section === binding.section && other.labelKey === binding.labelKey && rows.some((row) => row.id === other.id));
}

describe("palette coverage: no binding is lost without a keyboard", () => {
  it.each(TABLES.map((table, index) => [index, table] as const))("table %i: every binding has a palette row or a gesture", (_index, table) => {
    const rows = paletteEntries(asCommands(table), { showTabs: true });
    const lost = table.filter((binding) => replacingGesture(binding.id) === null && !hasPaletteRow(binding, table, rows))
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
    const staleExclusions = PALETTE_EXCLUSIONS.map((exclusion) => exclusion.idPattern)
      .filter((pattern) => !ALL.some((binding) => (pattern.endsWith(".") ? binding.id.startsWith(pattern) : binding.id === pattern)));
    const staleFamilies = PALETTE_FAMILIES.filter((prefix) => !ALL.some((binding) => binding.id.startsWith(prefix)));
    const stale = [...staleExclusions, ...staleFamilies];
    expect(stale).toEqual([]);
  });

  it("every alias and every palette label still names a binding", () => {
    const stale = [...PALETTE_ALIASES, ...Object.keys(PALETTE_LABELS)].filter((id) => !ALL.some((binding) => binding.id === id));
    expect(stale).toEqual([]);
  });

  it("no two palette rows of one table read the same — a pair of opposites says which way it goes", () => {
    for (const table of TABLES) {
      const rows = paletteEntries(asCommands(table), { showTabs: true }).filter((row) => !isFamilyMember(row.id));
      const words = rows.map((row) => `${row.label.namespace}:${row.label.key}`);
      expect(words.filter((word, index) => words.indexOf(word) !== index)).toEqual([]);
    }
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
