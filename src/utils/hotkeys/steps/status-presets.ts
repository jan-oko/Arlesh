import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";

/** What the status presets act on. */
export interface StepsStatusPresetContext {
  onSetStatusMode: (mode: StatusMode) => void;
}

/** The same five Alt+letter presets every other view carries, writing through to the same shared
 * filter — a Step shows the set the other three views would show. */
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
];

export const STEPS_STATUS_PRESET_BINDINGS: readonly Binding<StepsStatusPresetContext>[] =
  STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
    id: `stepsView.status.${mode}`,
    section: "stepsView" as const,
    chord: { code, alt: true },
    labelKey,
    run: (c: StepsStatusPresetContext) => c.onSetStatusMode(mode),
  }));
