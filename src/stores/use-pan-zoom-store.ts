import { createStore, type StoreApi } from "zustand";

/** A canvas transform: translation in screen px, plus scale. */
export interface PanZoomTransform {
  x: number;
  y: number;
  scale: number;
}

export interface PanZoomStore {
  /** Where the tab's canvas was left. `null` until the tab's mindmap has been on screen once. */
  transform: PanZoomTransform | null;
  setTransform: (transform: PanZoomTransform) => void;
}

/**
 * One tab's canvas position, so switching away and back does not re-centre the map.
 *
 * Nothing subscribes to it — `use-pan-zoom` reads it once when a canvas mounts and writes back when
 * that canvas goes away, which is also what makes the hand-off happen at exactly the right moment
 * when the active tab changes underneath a canvas that stays mounted.
 *
 * Deliberately **not** persisted: pan and zoom are working state, and a restored viewport onto a
 * board that has moved on is worse than the default framing.
 */
export function createPanZoomStore(): StoreApi<PanZoomStore> {
  return createStore<PanZoomStore>()((set) => ({
    transform: null,
    setTransform: (transform) => set({ transform }),
  }));
}
