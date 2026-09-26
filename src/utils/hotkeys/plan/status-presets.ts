import type { Binding } from "@/utils/hotkeys/chord";

/** What the status presets act on in the Plan View. */
export interface PlanStatusPresetContext {
  /** Says why the preset cannot change here. */
  onRefuseStatusPreset: () => void;
}

/**
 * The five Alt+letter presets the other views carry. The Plan View always reads under **Plan**, so
 * here they change nothing — but a press with no visible effect reads as a key that is not bound, so
 * each one says why in a toast instead. Hidden from the sheet: listing "All" against a key that
 * cannot choose All would be the sheet disagreeing with the view.
 */
const STATUS_PRESET_CODES: ReadonlyArray<{ code: string; id: string }> = [
  { code: "KeyA", id: "all" },
  { code: "KeyP", id: "plan" },
  { code: "KeyS", id: "start" },
  { code: "KeyD", id: "do" },
  { code: "KeyB", id: "backlog" },
];

export const PLAN_STATUS_PRESET_BINDINGS: readonly Binding<PlanStatusPresetContext>[] =
  STATUS_PRESET_CODES.map(({ code, id }) => ({
    id: `planView.status.${id}`,
    section: "planView" as const,
    chord: { code, alt: true },
    labelKey: "statusPlan",
    hidden: true,
    run: (c: PlanStatusPresetContext) => c.onRefuseStatusPreset(),
  }));
