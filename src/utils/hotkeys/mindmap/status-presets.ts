import type { StatusMode } from "@/utils/filter-tree";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";

/** What the status presets act on. */
export interface MindmapStatusPresetContext {
  onSetStatusMode: (mode: StatusMode) => void;
}

const STATUS_PRESETS: ReadonlyArray<{ code: string; mode: StatusMode; labelKey: HotkeyLabelKey }> = [
  { code: "KeyA", mode: "all", labelKey: "statusAll" },
  { code: "KeyP", mode: "plan", labelKey: "statusPlan" },
  { code: "KeyS", mode: "start", labelKey: "statusStart" },
  { code: "KeyD", mode: "do", labelKey: "statusDo" },
  { code: "KeyB", mode: "backlog", labelKey: "statusBacklog" },
];

export const MINDMAP_STATUS_PRESET_BINDINGS: readonly Binding<MindmapStatusPresetContext>[] =
  STATUS_PRESETS.map(({ code, mode, labelKey }) => ({
    id: `mindmap.status.${mode}`,
    section: "mindmap" as const,
    chord: { code, alt: true },
    labelKey,
    run: (c: MindmapStatusPresetContext) => c.onSetStatusMode(mode),
  }));
