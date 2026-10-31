import { useEffect, useRef, type RefObject } from "react";
import { PINCH_STEP, pinchScale, type TouchSample, type TwoFingers } from "@/utils/touch/gestures";

interface Options {
  enabled: boolean;
  /** One step in: the fingers spread by another `PINCH_STEP`. */
  onZoomIn: () => void;
  /** One step out: the fingers closed by another `PINCH_STEP`. */
  onZoomOut: () => void;
}

function fingers(event: TouchEvent): TwoFingers | null {
  const [a, b] = [event.touches[0], event.touches[1]];
  if (a === undefined || b === undefined) return null;
  const at = (touch: Touch): TouchSample => ({ x: touch.clientX, y: touch.clientY, t: event.timeStamp });
  return [at(a), at(b)];
}

/**
 * Pinch to zoom, for a view whose zoom moves in steps — the Steps View's card sizes. Each
 * `PINCH_STEP` the fingers spread or close by is one step, so a long pinch walks several.
 */
export function usePinchSteps(containerRef: RefObject<HTMLElement | null>, { enabled, onZoomIn, onZoomOut }: Options): void {
  const latest = useRef({ onZoomIn, onZoomOut });
  useEffect(() => {
    latest.current = { onZoomIn, onZoomOut };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) return;
    let anchor: TwoFingers | null = null;

    function onTouchStart(event: TouchEvent) {
      anchor = event.touches.length === 2 ? fingers(event) : null;
    }
    function onTouchMove(event: TouchEvent) {
      const now = event.touches.length === 2 ? fingers(event) : null;
      if (anchor === null || now === null) return;
      const scale = pinchScale(anchor, now);
      if (scale >= PINCH_STEP) { latest.current.onZoomIn(); anchor = now; }
      else if (scale <= 1 / PINCH_STEP) { latest.current.onZoomOut(); anchor = now; }
    }
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) anchor = null;
    }

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [containerRef, enabled]);
}
