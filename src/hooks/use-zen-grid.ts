import { useCallback, useLayoutEffect, useState } from "react";
import type { ZenArea, ZenGridLayout } from "@/utils/zen-grid";
import { fitZenGrid } from "@/utils/zen-grid";

interface MeasuredZenGrid {
  /** Attach to the element the grid fills — the area left below the strips. */
  ref: (element: HTMLElement | null) => void;
  layout: ZenGridLayout;
}

/**
 * Measures the Zen View's grid area and fits `count` cards to it (see `fitZenGrid`).
 *
 * The area is followed both ways, so the cards grow and shrink with the window, with a strip coming
 * or going, and with the fullscreen mode. Until the area has a real size — the first frame, or an
 * environment without layout — the fit is asked with no area and draws minimum cards, scrolling:
 * a zero-sized area is one not laid out yet, not one with room for nothing.
 *
 * `ResizeObserver` is absent from some test environments; its absence costs the re-measure, not the
 * render — the layout effect measures once either way.
 */
export function useZenGrid(count: number): MeasuredZenGrid {
  const [area, setArea] = useState<ZenArea | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);

  const ref = useCallback((next: HTMLElement | null) => { setElement(next); }, []);

  useLayoutEffect(() => {
    if (element === null) return;
    const measure = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setArea(width > 0 && height > 0 ? { width, height } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, layout: fitZenGrid(count, area) };
}
