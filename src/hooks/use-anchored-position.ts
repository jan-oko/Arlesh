import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { findAnchorElement } from "@/utils/anchor-element";

/** Room kept between the popover and the anchor, and between it and the window's edges. */
const GAP_PX = 6;

/** Where a fixed popover's top-left corner goes, in viewport pixels. */
export interface AnchoredPosition {
  top: number;
  left: number;
}

/**
 * Where the popover goes: below the anchor's box, left edges aligned — or above it when there is no
 * room below — and never past the window's edges. With no anchor drawn, the window's top-left.
 */
function positionFor(anchor: DOMRect | null, size: { width: number; height: number }): AnchoredPosition {
  if (anchor === null) return { top: GAP_PX, left: GAP_PX };
  const below = anchor.bottom + GAP_PX;
  const fitsBelow = below + size.height <= window.innerHeight - GAP_PX;
  const top = fitsBelow ? below : Math.max(GAP_PX, anchor.top - GAP_PX - size.height);
  const left = Math.max(GAP_PX, Math.min(anchor.left, window.innerWidth - GAP_PX - size.width));
  return { top, left };
}

/**
 * Places a popover at the drawn element carrying `anchorAttribute="anchorId"` — the quick pickers'
 * way of opening at the selected node, row or card. Re-placed on a window resize and whenever
 * `layoutKey` changes, which a popover whose size changes passes so it stays inside the window.
 */
export function useAnchoredPosition(
  popover: RefObject<HTMLElement | null>,
  anchorAttribute: string,
  anchorId: string,
  layoutKey: string,
): AnchoredPosition {
  const [position, setPosition] = useState<AnchoredPosition>({ top: GAP_PX, left: GAP_PX });

  useLayoutEffect(() => {
    function place() {
      const anchor = findAnchorElement(anchorAttribute, anchorId);
      const own = popover.current?.getBoundingClientRect();
      const size = { width: own?.width ?? 0, height: own?.height ?? 0 };
      const next = positionFor(anchor?.getBoundingClientRect() ?? null, size);
      setPosition((current) => (current.top === next.top && current.left === next.left ? current : next));
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [popover, anchorAttribute, anchorId, layoutKey]);

  return position;
}
