import type { Binding } from "./chord";

/** What the tab bindings act on. */
export interface TabContext {
  onOpenTab: () => void;
  onCloseTab: () => void;
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
 * Tab bindings, which are **global**: they stay live while a modal or the cheat-sheet is open,
 * because switching tabs is never ambiguous about what it means, unlike a view shortcut that would
 * act on whatever is behind the modal.
 *
 * `Ctrl+W` is the app's, not the window's — the dispatcher takes the event in the capture phase
 * and calls `preventDefault`, and Arlesh declares no native menu accelerator that would claim it
 * first. Closing the last tab is what closes the window.
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
