import type { Binding } from "@/utils/hotkeys/chord";

/** What the Review preset binding acts on. */
export interface ListReviewPresetContext {
  /** Selects the List View's **Review** option, leaving the shared status preset untouched. */
  onSetReviewPreset: () => void;
}

/**
 * `Alt+E` — the List View's third option that is not a status preset, beside Unblock's `Alt+U` and
 * Expectations' `Alt+W`. Like them it writes the list's own preset and leaves the shared one for the
 * Mindmap, which has no Review option to come back to. A press while Review is already the option
 * clears it, back to the shared preset (the caller decides; see `ListView`).
 */
export const LIST_REVIEW_PRESET_BINDINGS: readonly Binding<ListReviewPresetContext>[] = [
  {
    id: "listView.preset.review", section: "listView", chord: { code: "KeyE", alt: true },
    labelKey: "statusReview", run: (c) => c.onSetReviewPreset(),
  },
];
