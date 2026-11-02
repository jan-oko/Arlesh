import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanPane } from "@/utils/hotkeys/plan/selection";
import { planDropPointAt } from "@/utils/plan-drag";
import type { PlanDropPoint } from "@/utils/plan-drag";

/** How near a pane's edge (px) a finger must be for the pane to scroll toward it. */
const EDGE_PX = 48;
/** How far (px) a scrolling pane moves each tick while the finger is at an edge. */
const SCROLL_STEP_PX = 10;
const SCROLL_TICK_MS = 16;

interface Options {
  /** What a drag that began on this card carries: its pane and the ids, selecting it first as the mouse's does. */
  begin: (id: string) => { pane: PlanPane; ids: string[] } | null;
  /** Whether a bucket, or the pane at large, takes a drop of rows from `from` (a split pane has no "at large"). */
  accepts: (point: PlanDropPoint, from: PlanPane) => boolean;
  /** The drop, through the very path the mouse's `drop` takes. */
  drop: (point: PlanDropPoint, carried: { pane: PlanPane; ids: string[] }) => void;
}

/** A card being carried by a finger. */
export interface PlanTouchDrag {
  /** The card the finger holds, while it holds one. */
  sourceId: string | null;
  /** How many rows it carries. */
  count: number;
  /** Where the finger is, for the ghost that follows it. */
  ghost: { x: number; y: number } | null;
  /** The target under the finger, if it takes the drop. */
  over: PlanDropPoint | null;
  /** The three steps `useTouchGestures`' `holdDrag` drives. */
  controls: {
    start: (id: string, x: number, y: number) => void;
    move: (x: number, y: number) => void;
    end: (x: number, y: number) => void;
  };
}

/**
 * The Plan View's drag on a touchscreen: hold a card, then move — the Mindmap's hold-and-drag
 * (`docs/spec/touch.md`) — carrying it to the other pane or onto a subscope bucket. A hold released
 * without moving never reaches this (it is the long-press). While the finger rests near the top or
 * bottom edge of a pane's list that list scrolls, so a bucket out of view can be reached.
 */
export function usePlanTouchDrag({ begin, accepts, drop }: Options): PlanTouchDrag {
  const [state, setState] = useState<{ sourceId: string | null; count: number; ghost: { x: number; y: number } | null; over: PlanDropPoint | null }>(
    { sourceId: null, count: 0, ghost: null, over: null },
  );
  const carried = useRef<{ pane: PlanPane; ids: string[] } | null>(null);
  const finger = useRef<{ x: number; y: number } | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef({ begin, accepts, drop });
  useEffect(() => { latest.current = { begin, accepts, drop }; });

  const stopScrolling = useCallback(() => {
    if (scrollTimer.current !== null) clearInterval(scrollTimer.current);
    scrollTimer.current = null;
  }, []);
  useEffect(() => stopScrolling, [stopScrolling]);

  /** Scrolls the list under the finger when it is within `EDGE_PX` of that list's top or bottom. */
  const scrollTick = useCallback(() => {
    const at = finger.current;
    if (at === null) return;
    const list = document.elementFromPoint(at.x, at.y)?.closest("[data-plan-pane]")?.querySelector("[data-plan-scroll]");
    if (!(list instanceof HTMLElement)) return;
    const box = list.getBoundingClientRect();
    if (at.y < box.top + EDGE_PX) list.scrollTop -= SCROLL_STEP_PX;
    else if (at.y > box.bottom - EDGE_PX) list.scrollTop += SCROLL_STEP_PX;
  }, []);

  const start = useCallback((id: string) => {
    const taken = latest.current.begin(id);
    carried.current = taken;
    finger.current = null;
    if (taken !== null) setState({ sourceId: id, count: taken.ids.length, ghost: null, over: null });
  }, []);

  const move = useCallback((x: number, y: number) => {
    if (carried.current === null) return;
    finger.current = { x, y };
    const point = planDropPointAt(x, y);
    const over = point !== null && latest.current.accepts(point, carried.current.pane) ? point : null;
    setState((current) => ({ ...current, ghost: { x, y }, over }));
    if (scrollTimer.current === null) scrollTimer.current = setInterval(scrollTick, SCROLL_TICK_MS);
  }, [scrollTick]);

  const end = useCallback((x: number, y: number) => {
    const taken = carried.current;
    carried.current = null;
    finger.current = null;
    stopScrolling();
    setState({ sourceId: null, count: 0, ghost: null, over: null });
    if (taken === null) return;
    const point = planDropPointAt(x, y);
    if (point !== null && latest.current.accepts(point, taken.pane)) latest.current.drop(point, taken);
  }, [stopScrolling]);

  return { ...state, controls: { start, move, end } };
}
