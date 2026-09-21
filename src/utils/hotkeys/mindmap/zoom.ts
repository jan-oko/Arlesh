import type { Binding } from "@/utils/hotkeys/chord";

/** What zooming acts on. */
export interface MindmapZoomContext {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const MINDMAP_ZOOM_BINDINGS: readonly Binding<MindmapZoomContext>[] = [
  {
    id: "mindmap.zoomIn", section: "mindmap", chord: { code: "Equal", ctrl: true },
    labelKey: "zoomIn", run: (c) => c.onZoomIn(),
  },
  {
    id: "mindmap.zoomInNumpad", section: "mindmap", chord: { code: "NumpadAdd", ctrl: true },
    labelKey: "zoomIn", run: (c) => c.onZoomIn(),
  },
  {
    id: "mindmap.zoomOut", section: "mindmap", chord: { code: "Minus", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onZoomOut(),
  },
  {
    id: "mindmap.zoomOutNumpad", section: "mindmap", chord: { code: "NumpadSubtract", ctrl: true },
    labelKey: "zoomOut", run: (c) => c.onZoomOut(),
  },
];
