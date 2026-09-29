import type { Binding } from "@/utils/hotkeys/chord";
import type { ZenStrip } from "@/stores/use-view-store";

/** What showing and hiding the strips acts on. */
export interface ZenStripsContext {
  /** Shows the strip if it is hidden, hides it if it is shown — the tab's own toggle. */
  onToggleStrip: (strip: ZenStrip) => void;
}

/**
 * `Alt+C` and `Alt+E` — the Commitments and Expectations strips. On `Alt` beside the presets because
 * each is a question about what the view shows, not an act on the selection. `Alt+E` is the List
 * View's Expectations option there; the Zen View does not borrow that binding (it always reads
 * under Do), so the chord is free here, and the two tables are never mounted together.
 */
export const ZEN_STRIP_BINDINGS: readonly Binding<ZenStripsContext>[] = [
  {
    id: "zenView.toggleCommitments", section: "zenView", chord: { code: "KeyC", alt: true },
    labelKey: "zenToggleCommitments", allowRepeat: false, run: (c) => c.onToggleStrip("commitments"),
  },
  {
    id: "zenView.toggleExpectations", section: "zenView", chord: { code: "KeyE", alt: true },
    labelKey: "zenToggleExpectations", allowRepeat: false, run: (c) => c.onToggleStrip("expectations"),
  },
];
