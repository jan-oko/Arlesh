import { useLayoutEffect, useRef, useState } from "react";

/** What {@link useCrumbOverflow} hands back: the ref for the clipping box, and how many segments fold. */
export interface CrumbOverflow {
  /** Attach to the element whose width the chain has to fit inside — the one that clips it. */
  boxRef: (element: HTMLElement | null) => void;
  /** How many foldable segments give up their place, counted from the root end. */
  folded: number;
}

/**
 * How many of a breadcrumb's foldable segments have to give up their place for the chain to fit the
 * width it is given.
 *
 * Measured rather than counted: how many levels fit depends on how long their titles are and how
 * much room the bar has left, neither of which a fixed "collapse past N" rule can know. The chain
 * is laid out in full, and if it overflows its box one more segment folds away — repeated, one
 * render at a time, until it fits or `maxFolded` is reached. Each pass is a layout effect, so the
 * folding happens before the browser paints and the overflowing chain is never seen.
 *
 * Folding only ever grows here. Anything that could give the chain more room again — a different
 * chain, or the box changing width — resets the count to zero and has it measured out from
 * scratch, which is what keeps the count from ratcheting: unfolding on the strength of a
 * measurement taken while folded would put back a segment that never fitted, overflow, and fold it
 * again forever.
 *
 * The box is taken through a callback ref and held as state, not read off a ref object. A breadcrumb
 * draws nothing at the true root, so its box comes and goes with every subtree entered and left: a
 * ref object never says when that happens, and an observer attached on mount would be watching
 * nothing (mounted at the root) or a box long since removed (after leaving and re-entering). Each
 * box that appears is observed from the moment it does.
 *
 * @param maxFolded how many segments may fold away at most (the ones that must survive are excluded)
 * @param chainKey identifies the chain being shown, so a different one starts its own measurement
 */
export function useCrumbOverflow(maxFolded: number, chainKey: string): CrumbOverflow {
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [folded, setFolded] = useState(0);
  const [measuredChain, setMeasuredChain] = useState(chainKey);
  // The box's width, held as state as well as in a ref: the ref is what a resize is compared
  // against, the state is what makes the chain measure itself again once the box has changed.
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const lastWidth = useRef<number | null>(null);

  // Reset during the render rather than in an effect: React re-runs the render with the new state
  // before any layout effect fires, so the measurement below always judges an unfolded chain
  // instead of racing a reset that has been scheduled but not applied.
  if (measuredChain !== chainKey) {
    setMeasuredChain(chainKey);
    setFolded(0);
  }

  // `folded` is a dependency of its own measurement on purpose: folding a segment away is what
  // makes the next measurement a different one, and the loop stops the moment the chain fits or
  // there is nothing left that may fold.
  useLayoutEffect(() => {
    if (box === null || folded >= maxFolded) return;
    if (box.scrollWidth <= box.clientWidth) return;
    // A layout measurement is what this effect exists for, and nothing a render could compute: the
    // box's widths are known only once it has been laid out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolded(folded + 1);
  }, [box, folded, maxFolded, chainKey, boxWidth]);

  useLayoutEffect(() => {
    if (box === null) return;

    // A new box has no width on record yet, so its first report always counts as a change.
    lastWidth.current = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === lastWidth.current) return;
      lastWidth.current = width;
      setBoxWidth(width);
      setFolded(0);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  return { boxRef: setBox, folded };
}
