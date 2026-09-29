import type { Binding } from "@/utils/hotkeys/chord";
import type { ZenDirection } from "@/utils/zen-grid";

/** What moving between cards acts on. */
export interface ZenNavigateContext {
  /** Moves the selection one card in `direction` — see `zenNavigationTarget` for where it lands. */
  onNavigate: (direction: ZenDirection) => void;
}

const ARROWS: ReadonlyArray<{ code: string; direction: ZenDirection }> = [
  { code: "ArrowUp", direction: "up" },
  { code: "ArrowDown", direction: "down" },
  { code: "ArrowLeft", direction: "left" },
  { code: "ArrowRight", direction: "right" },
];

/**
 * The one List View binding the Zen View does not borrow: the list moves in one dimension and the
 * grid in two, so the four arrows are the Zen View's own. One label, so the cheat-sheet reads them
 * as a single row.
 */
export const ZEN_NAVIGATE_BINDINGS: readonly Binding<ZenNavigateContext>[] = ARROWS.map(({ code, direction }) => ({
  id: `zenView.navigate.${direction}`,
  section: "zenView" as const,
  chord: { code },
  labelKey: "zenNavigate" as const,
  run: (c: ZenNavigateContext) => c.onNavigate(direction),
}));
