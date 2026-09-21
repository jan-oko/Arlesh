import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";

/** What the status presets act on. */
export interface ListStatusPresetContext {
  onSetStatusMode: (mode: StatusMode) => void;
}

/** Alt+letter → status preset, matched on physical key so it works under any layout. */
const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
];

export const LIST_STATUS_PRESET_BINDINGS: readonly Binding<ListStatusPresetContext>[] =
  STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
    id: `listView.status.${mode}`,
    section: "listView" as const,
    chord: { code, alt: true },
    labelKey,
    run: (c: ListStatusPresetContext) => c.onSetStatusMode(mode),
  }));
