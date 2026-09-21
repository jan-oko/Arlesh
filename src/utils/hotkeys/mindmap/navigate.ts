import type { Orientation } from "@/utils/tree-layout";
import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** What the arrow keys act on. */
export interface MindmapNavigateContext extends MindmapSelectionContext {
  /** Which axis branches grow along — decides which Shift+arrows walk the sibling range. */
  orientation: Orientation;
  onNavigate: (key: ArrowKey) => void;
  onPanCanvas: (key: ArrowKey) => void;
  onExtendSelection: (key: ArrowKey) => void;
}

/**
 * Siblings spread across the axis branches *don't* grow along — that is the axis a Shift+arrow walks
 * a selection range over.
 */
function extendsSelection(orientation: Orientation, key: ArrowKey): boolean {
  const siblingAxis: readonly ArrowKey[] =
    orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  return siblingAxis.includes(key);
}

/**
 * The ordered family of behaviours for one arrow key. Shift+arrow has three fall-through outcomes in
 * the original handler — extend the selection on the sibling axis, else navigate, else pan — so all
 * three are modelled explicitly. The navigate/pan Shift variants are hidden from the cheat-sheet
 * because they duplicate the plain arrow rows.
 *
 * These are the one place in the app where entries sharing a chord are NOT complementary: the order
 * within a family is the fall-through itself. That is why the whole family lives in one module —
 * nothing outside this file can be interleaved into it.
 */
function arrowBindings(key: ArrowKey, labelKey: HotkeyLabelKey): readonly Binding<MindmapNavigateContext>[] {
  return [
    {
      id: `mindmap.extendSelection.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey: "extendSelection",
      when: (c) => extendsSelection(c.orientation, key),
      run: (c) => c.onExtendSelection(key),
    },
    {
      id: `mindmap.navigateShift.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey, hidden: true,
      when: hasSelection,
      run: (c) => c.onNavigate(key),
    },
    {
      id: `mindmap.panShift.${key}`, section: "mindmap", chord: { code: key, shift: true },
      labelKey, hidden: true,
      run: (c) => c.onPanCanvas(key),
    },
    {
      id: `mindmap.navigate.${key}`, section: "mindmap", chord: { code: key },
      labelKey,
      when: hasSelection,
      run: (c) => c.onNavigate(key),
    },
    {
      id: `mindmap.pan.${key}`, section: "mindmap", chord: { code: key },
      labelKey: "panCanvas",
      run: (c) => c.onPanCanvas(key),
    },
  ];
}

// All four share one label so the cheat-sheet merges them into a single "← → ↑ ↓" row.
export const MINDMAP_NAVIGATE_BINDINGS: readonly Binding<MindmapNavigateContext>[] = [
  ...arrowBindings("ArrowLeft", "navigate"),
  ...arrowBindings("ArrowRight", "navigate"),
  ...arrowBindings("ArrowUp", "navigate"),
  ...arrowBindings("ArrowDown", "navigate"),
];
