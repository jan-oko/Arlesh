import type { Binding } from "./chord";

/** What the tab bindings act on. */
export interface TabContext {
  /**
   * Whether a modal or an inline editor holds the keyboard. Only the tear-off reads it — see the
   * table's note on why that one chord is guarded where the rest are not.
   */
  isInputCaptured: boolean;
  onOpenTab: () => void;
  onOpenWindow: () => void;
  onCloseTab: () => void;
  onTearOffTab: () => void;
  onNextTab: () => void;
  onPreviousTab: () => void;
  onJumpToTab: (position: number) => void;
}

/** The nine positional jumps, declared from one shape so the table cannot drift out of step. */
const JUMP_BINDINGS: readonly Binding<TabContext>[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
  (position): Binding<TabContext> => ({
    id: `tabs.jump${position}`,
    section: "tabs",
    chord: { code: `Digit${position}`, ctrl: true },
    labelKey: "jumpToTab",
    // Only the first is listed: nine rows saying the same thing would crowd out every other
    // shortcut on the cheat-sheet, and the label names the range.
    ...(position === 1 ? {} : { hidden: true }),
    run: (c) => c.onJumpToTab(position),
  }),
);

/**
 * Tab and window bindings, which are **global**: they stay live while a modal or the cheat-sheet is
 * open, because switching or opening a tab is never ambiguous about what it means, unlike a view
 * shortcut that would act on whatever is behind the modal.
 *
 * `Ctrl+N` opens a **window** beside `Ctrl+T`'s **tab**, which is the pairing every desktop app
 * uses and so needs no explaining. It is unguarded for the same reason `Ctrl+T` is: it makes a new
 * thing and touches nothing that exists, so there is nothing for an open modal to be ambiguous
 * about.
 *
 * `Ctrl+Alt+N` reads as "the same thing, but with what I am holding" — the tab comes out into the
 * new window. It is the **one guarded binding in this table**, and the difference is real rather
 * than cautious: a tear-off carries the tab's *persisted* state across, and an open modal or
 * inline editor is React state inside the tab, not persisted. So tearing off from under one would
 * silently drop whatever is being typed into it. `Ctrl+W` loses it too, but a close is a gesture
 * that says "throw this away"; a move that quietly drops the contents is a different thing.
 *
 * `Ctrl+W` and `Ctrl+N` are the app's, not the window's — the dispatcher takes the event in the
 * capture phase and calls `preventDefault`, and Arlesh declares no native menu accelerator that
 * would claim either first. Closing the last tab is what closes the window.
 */
export const TAB_BINDINGS: readonly Binding<TabContext>[] = [
  {
    id: "tabs.open",
    section: "tabs",
    chord: { code: "KeyT", ctrl: true },
    labelKey: "openTab",
    run: (c) => c.onOpenTab(),
  },
  {
    id: "tabs.openWindow",
    section: "tabs",
    chord: { code: "KeyN", ctrl: true },
    labelKey: "openWindow",
    run: (c) => c.onOpenWindow(),
  },
  {
    id: "tabs.tearOff",
    section: "tabs",
    chord: { code: "KeyN", ctrl: true, alt: true },
    labelKey: "tearOffTab",
    when: (c) => !c.isInputCaptured,
    allowRepeat: false,
    run: (c) => c.onTearOffTab(),
  },
  {
    id: "tabs.close",
    section: "tabs",
    chord: { code: "KeyW", ctrl: true },
    labelKey: "closeTab",
    allowRepeat: false,
    run: (c) => c.onCloseTab(),
  },
  {
    id: "tabs.next",
    section: "tabs",
    chord: { code: "Tab", ctrl: true },
    labelKey: "nextTab",
    run: (c) => c.onNextTab(),
  },
  {
    id: "tabs.previous",
    section: "tabs",
    chord: { code: "Tab", ctrl: true, shift: true },
    labelKey: "previousTab",
    run: (c) => c.onPreviousTab(),
  },
  ...JUMP_BINDINGS,
];
