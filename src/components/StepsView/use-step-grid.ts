import { useCallback, useLayoutEffect, useState } from "react";
import type { StepGrid, StepsZoom } from "@/utils/steps-grid";
import { stepGrid } from "@/utils/steps-grid";

interface Measured {
  /** Attach to the element whose size decides the page. */
  ref: (element: HTMLElement | null) => void;
  /** The grid that fits, or `null` until the area has a real size — see `resolveGrid`. */
  grid: StepGrid | null;
}

/**
 * Measures the Step's card area and derives the grid that fits in it at `zoom`.
 *
 * The page size is a **consequence** of the zoom and the viewport rather than a setting of its own,
 * so this is the only place either is turned into a number of cards. The alternative — a stored
 * page size beside the zoom — contradicts itself on the first window resize: a page of twelve in an
 * area that fits eight either overflows or scrolls, and not scrolling is the point of the view.
 *
 * It reports `null` rather than a grid until the area has a **real** size. A zero-sized area is not
 * an area that fits one card; it is one that has not been laid out yet, and treating the two alike
 * would make the first paint a single card beside a pager that vanishes a frame later.
 *
 * `ResizeObserver` is absent in some test environments and in old webviews. Its absence costs the
 * *re-measure*, not the render: the layout effect takes one measurement either way, so the grid is
 * right on mount and merely stops following a resize.
 */
export function useStepGrid(zoom: StepsZoom): Measured {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);

  const ref = useCallback((next: HTMLElement | null) => { setElement(next); }, []);

  useLayoutEffect(() => {
    if (element === null) return;
    const measure = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, grid: size === null ? null : stepGrid(size.width, size.height, zoom) };
}
