import type { Binding } from "@/utils/hotkeys/chord";

/** What the Unblock preset binding acts on. */
export interface ListUnblockPresetContext {
  /** Selects the List View's **Unblock** preset, leaving the shared status preset untouched. */
  onSetUnblockPreset: () => void;
}

/**
 * `Alt+U` — the sixth Alt+letter preset, and the one that is not a status preset.
 *
 * Its five neighbours in `status-presets.ts` are a uniform table: each writes a status mode through
 * to the *shared* `FilterState`, so the preset chosen in the List View is the one the Mindmap comes
 * back to. Unblock is List-View-only — it overrides the status preset with
 * "blocked tasks only" rather than being one — and the Mindmap's preset has no Unblock to come
 * back to, so writing it to the shared state would leave the canvas holding a value it cannot
 * render. It therefore writes the *list* preset alone, and lives here rather than widening that
 * table's context beyond `onSetStatusMode`.
 *
 * A plain set, like its five neighbours: Alt+U means "show me the blocked work", and any of the
 * other five chords is the way back out. Nothing here remembers what was selected before.
 */
export const LIST_UNBLOCK_PRESET_BINDINGS: readonly Binding<ListUnblockPresetContext>[] = [
  {
    id: "listView.preset.unblock", section: "listView", chord: { code: "KeyU", alt: true },
    labelKey: "statusUnblock", run: (c) => c.onSetUnblockPreset(),
  },
];
