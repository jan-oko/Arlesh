import type { Binding } from "./chord";
import type { View } from "@/stores/use-view-store";

/** What the app-level bindings act on. */
export interface GlobalContext {
  /**
   * Whether a modal or an inline editor holds the keyboard. Only the view switcher reads it: the
   * cheat-sheet's own toggle has to stay live to close itself, and quitting is never ambiguous.
   */
  isInputCaptured: boolean;
  onSetView: (view: View) => void;
  onToggleHotkeys: () => void;
  onToggleFullscreen: () => void;
  onQuit: () => void;
  /** Whether the tab is re-rooted at a subtree — gates the two exit chords, as it did per view. */
  subtreeRootId: string | null;
  onExitSubtree: () => void;
  onExitToRoot: () => void;
  onOpenSearch: () => void;
  onToggleFilter: () => void;
}

/**
 * Bindings that apply everywhere, regardless of which view is showing.
 *
 * **One chord per view, not a cycle.** `Alt+L` used to toggle Mindmap ↔ List; with a third view it
 * would have had to become "next view", quietly turning an existing reflex into something else, and
 * a fourth would have made the cycle order one more thing to learn. Each view is instead one press
 * from any other, and a fifth costs one binding rather than a re-think.
 *
 * **The switcher is on `Ctrl`, and the status presets keep `Alt` untouched.** `Alt+A/P/S/D/B`
 * have been All/Plan/Start/Do/Backlog since the presets shipped, in every view's table, and they
 * are generated from one `{ code, alt: true }` table rather than written out — which is why a
 * switcher reaching for `Alt+P` found nothing when grepped for and would have fired both actions
 * on one press. The two tables are dispatched by two listeners, so `preventDefault` on the first
 * does not stop the second, and nothing orders them. Moving the *views* was the cheaper side.
 *
 * `Ctrl+P` and `Ctrl+S` are webview defaults (print, save), and this app takes them the same way it
 * already takes `Ctrl+W` and `Ctrl+T`: the dispatcher reads the event in the capture phase and
 * calls `preventDefault`, and Arlesh declares no native menu accelerator that would claim them
 * first. Nothing reaches the switcher from inside a text field either — the dispatcher returns
 * early on a typing target — so a save reflex in a rename box is still just a save reflex that
 * does nothing.
 *
 * **`Ctrl+S` is held for the Steps View** (Arlesh-c1g) and is deliberately left unbound, so the
 * scheme is already decided by the time that view arrives.
 *
 * These three are the one part of this table that is **not** always live: unlike quitting or the
 * cheat-sheet, switching views behind an open modal would leave the modal sitting over a board it
 * no longer belongs to.
 */
export const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[] = [
  {
    id: "global.viewMindmap",
    section: "global",
    chord: { code: "KeyM", ctrl: true },
    labelKey: "viewMindmap",
    when: (c) => !c.isInputCaptured,
    run: (c) => c.onSetView("mindmap"),
  },
  {
    id: "global.viewList",
    section: "global",
    chord: { code: "KeyL", ctrl: true },
    labelKey: "viewList",
    when: (c) => !c.isInputCaptured,
    run: (c) => c.onSetView("list"),
  },
  {
    id: "global.viewPlan",
    section: "global",
    chord: { code: "KeyP", ctrl: true },
    labelKey: "viewPlan",
    when: (c) => !c.isInputCaptured,
    run: (c) => c.onSetView("plan"),
  },
  {
    // F11 is the key every app uses for this, and it is free here. The board-alone mode is also on
    // bare F when nothing is selected — declared per view, since only a view knows its selection.
    id: "global.toggleFullscreen",
    section: "global",
    chord: { code: "F11" },
    labelKey: "toggleFullscreen",
    run: (c) => c.onToggleFullscreen(),
  },
  {
    // Quitting has to be reachable without the mouse, because with close-to-tray on the close
    // button no longer does it. Ctrl+Q is where every desktop app puts this.
    id: "global.quit",
    section: "global",
    chord: { code: "KeyQ", ctrl: true },
    labelKey: "quitApp",
    allowRepeat: false,
    run: (c) => c.onQuit(),
  },
  {
    // The chord the sheet has had since it shipped, and it keeps it: the Mindmap's recursive
    // expand went to Ctrl+Alt+/ rather than split this one. Carrying no guard, it is reachable in
    // every state — including with a cell selected, and including while the sheet is already open,
    // which is what closes it again.
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
  // --- Promoted out of the view tables ---
  //
  // These were declared once per view with byte-identical chords and run bodies, which meant the
  // cheat-sheet printed each of them once per view and a fourth view meant a fourth copy. They are
  // not view behaviour: the subtree root, the search and the filter set are all **per tab**, and
  // every view was calling the same tab store through its own context member.
  //
  // Each one is **removed** from the view tables at the same time. Global and view tables are
  // separate capture-phase listeners, so ADR 0003's first-match rule cannot order them — a chord
  // left in both would fire twice. `chord-sharing.test.ts`'s `crossTableGroups` is what holds that.
  //
  // They all carry the input-capture guard, because that is what makes the promotion a move rather
  // than a change: as view bindings they were suppressed whenever a modal or an inline rename held
  // the keyboard, and the global table is otherwise dispatched unconditionally.
  {
    id: "global.exitToRoot",
    section: "global",
    chord: { code: "Escape", ctrl: true },
    labelKey: "exitToRoot",
    when: (c) => !c.isInputCaptured && c.subtreeRootId !== null,
    run: (c) => c.onExitToRoot(),
  },
  {
    id: "global.exitSubtree",
    section: "global",
    chord: { code: "Escape", shift: true },
    labelKey: "exitSubtree",
    when: (c) => !c.isInputCaptured && c.subtreeRootId !== null,
    run: (c) => c.onExitSubtree(),
  },
  {
    // `enterBySearch` of the two labels the views carried, because it describes what the chord
    // actually does everywhere: picking a result re-roots the tab at that node. The Mindmap's
    // `openSearch` ("Search for a node") named the dialog rather than the gesture, and stopped
    // short of the half that matters.
    id: "global.openSearch",
    section: "global",
    chord: { code: "KeyO", ctrl: true },
    labelKey: "enterBySearch",
    when: (c) => !c.isInputCaptured,
    run: (c) => c.onOpenSearch(),
  },
  {
    id: "global.toggleFilter",
    section: "global",
    chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter",
    when: (c) => !c.isInputCaptured,
    run: (c) => c.onToggleFilter(),
  },
];
