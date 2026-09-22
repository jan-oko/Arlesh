import type { Binding } from "@/utils/hotkeys/chord";

/** What changing the card size acts on. */
export interface StepsZoomContext {
  onStepZoom: (direction: 1 | -1) => void;
}

/**
 * `Ctrl+=` / `Ctrl+-` change the card size, which is also what changes how many fit on a page.
 *
 * The Mindmap's zoom chords, on the view whose zoom means the nearest thing to them: there it
 * scales the canvas, here it sets the card size, and both answer "show me more at once, or show me
 * less in more detail". The setting itself lives in the gear popover under Steps, the way the
 * branch axis lives there under Mindmap.
 */
export const STEPS_ZOOM_BINDINGS: readonly Binding<StepsZoomContext>[] = [
  {
    id: "stepsView.zoomIn", section: "stepsView", chord: { code: "Equal", ctrl: true },
    labelKey: "zoomIn", run: (c) => c.onStepZoom(1),
  },
  {
    // The numpad pair, hidden because the sheet already lists Ctrl+= and Ctrl+-, exactly as the
    // Mindmap's are hidden. A reflex learned on one view should not die on another.
    id: "stepsView.zoomInNumpad", section: "stepsView", chord: { code: "NumpadAdd", ctrl: true },
    labelKey: "zoomIn", hidden: true, run: (c) => c.onStepZoom(1),
  },
  {
    id: "stepsView.zoomOut", section: "stepsView", chord: { code: "Minus", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onStepZoom(-1),
  },
  {
    id: "stepsView.zoomOutNumpad", section: "stepsView", chord: { code: "NumpadSubtract", ctrl: true },
    labelKey: "zoomOut", hidden: true, run: (c) => c.onStepZoom(-1),
  },
];
