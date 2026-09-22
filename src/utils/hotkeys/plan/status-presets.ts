import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";

/** What the status presets act on. */
export interface PlanStatusPresetContext {
  onSetStatusMode: (mode: StatusMode) => void;
}

/** The same five Alt+letter presets the other two views carry, writing through to the same shared
 * filter — the Plan View reads the board through it exactly as they do. */
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
];

export const PLAN_STATUS_PRESET_BINDINGS: readonly Binding<PlanStatusPresetContext>[] =
  STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
    id: `planView.status.${mode}`,
    section: "planView" as const,
    chord: { code, alt: true },
    labelKey,
    run: (c: PlanStatusPresetContext) => c.onSetStatusMode(mode),
  }));
