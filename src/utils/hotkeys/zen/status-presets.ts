import type { Binding } from "@/utils/hotkeys/chord";

/** What the status presets act on in the Zen View. */
export interface ZenStatusPresetContext {
  /** Says why the preset cannot change here. */
  onRefuseStatusPreset: () => void;
}

/**
 * The Alt+letter presets the other views carry, and the List View's `Alt+U`. The Zen View always
 * reads under **Do**, so here they change nothing — but a press with no visible effect reads as a
 * key that is not bound, so each says why in a toast instead, as the Plan View's do. Hidden from the
 * sheet: listing "All" against a key that cannot choose All would be the sheet disagreeing with the
 * view. `Alt+E` is not among them — it toggles the Expectations strip here.
 */
const PRESET_CODES: ReadonlyArray<{ code: string; id: string }> = [
  { code: "KeyA", id: "all" },
  { code: "KeyP", id: "plan" },
  { code: "KeyS", id: "start" },
  { code: "KeyD", id: "do" },
  { code: "KeyB", id: "backlog" },
  { code: "KeyU", id: "unblock" },
];

export const ZEN_STATUS_PRESET_BINDINGS: readonly Binding<ZenStatusPresetContext>[] =
  PRESET_CODES.map(({ code, id }) => ({
    id: `zenView.status.${id}`,
    section: "zenView" as const,
    chord: { code, alt: true },
    labelKey: "statusDo" as const,
    hidden: true,
    run: (c: ZenStatusPresetContext) => c.onRefuseStatusPreset(),
  }));
