import { useSpring, type SpringValues } from "@react-spring/web";
import { useCallback, useEffect, useRef } from "react";
import { useTabStores } from "@/stores/tab-stores-context";
import type { PanZoomTransform } from "@/stores/use-pan-zoom-store";

type Transform = PanZoomTransform;

/** The live transform plus the measured viewport size, for visibility maths. */
export interface Viewport extends Transform {
  width: number;
  height: number;
}

export interface PanZoomResult {
  springProps: SpringValues<Transform>;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  centerOnRoot: () => void;
  /** Pans so the layout point `(lx, ly)` sits at the viewport centre. */
  centerOnPoint: (lx: number, ly: number) => void;
  /** Pans to centre `(lx, ly)` only if it's currently outside the comfortable viewport. */
  ensureVisible: (lx: number, ly: number) => void;
  /** Pans by a screen-pixel offset (e.g. keyboard-driven panning when no node is focused). */
  panBy: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Current transform + measured viewport size (read on demand). */
  getViewport: () => Viewport;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;
const ZOOM_STEP = 1.2; // per Ctrl+= / Ctrl+-
/** How far two fingers must spread or close before a pinch zooms. */
const PINCH_DEAD_ZONE_PX = 16;
/** Screen-px margin: a selected node closer than this to an edge is treated as off-screen. */
const VISIBLE_MARGIN = 100;

export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>): PanZoomResult {
  const initialX = window.innerWidth / 2;
  const initialY = window.innerHeight / 2;

  const transform = useRef<Transform>({ x: initialX, y: initialY, scale: 1 });
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const panZoom = useTabStores().panZoom;

  const [springProps, api] = useSpring(() => ({
    x: initialX,
    y: initialY,
    scale: 1,
    config: { tension: 300, friction: 30 },
  }));

  const applyTransform = useCallback(
    (next: Transform) => {
      transform.current = next;
      api.start({ x: next.x, y: next.y, scale: next.scale });
    },
    [api],
  );

  /**
   * Hands the canvas over between tabs: restore where this tab left it, and — when the tab
   * underneath changes, or the canvas goes away — write back to the tab being left. The cleanup
   * closes over the *previous* tab's store, which is what puts each half on the right side of the
   * switch. Restoring is instant (`set`, not `start`): a tab switch is not a movement to animate.
   */
  useEffect(() => {
    const saved = panZoom.getState().transform;
    if (saved !== null) {
      transform.current = saved;
      api.set(saved);
    }
    return () => panZoom.getState().setTransform(transform.current);
  }, [panZoom, api]);

  // The visible canvas size — the real container rect, falling back to the window.
  const size = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? window.innerWidth, h: rect?.height ?? window.innerHeight };
  }, [svgRef]);

  // Left-click on canvas background or middle-click anywhere starts a pan
  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const onBackground = e.target === e.currentTarget;
    if ((e.button === 0 && onBackground) || e.button === 1) {
      e.preventDefault();
      isPanning.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      applyTransform({
        ...transform.current,
        x: transform.current.x + dx,
        y: transform.current.y + dy,
      });
    };

    const handleMouseUp = () => {
      isPanning.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [applyTransform]);

  // Zoom toward a focal point in transform (SVG-local) space, clamped.
  const zoomTo = useCallback(
    (targetScale: number, focalX: number, focalY: number) => {
      const cur = transform.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
      const ratio = newScale / cur.scale;
      applyTransform({
        x: focalX - (focalX - cur.x) * ratio,
        y: focalY - (focalY - cur.y) * ratio,
        scale: newScale,
      });
    },
    [applyTransform],
  );

  // Wheel must be registered imperatively with passive:false so preventDefault works
  useEffect(() => {
    const el = svgRef.current;
    if (el === null) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * WHEEL_SENSITIVITY;
      zoomTo(transform.current.scale + delta, e.clientX, e.clientY);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [svgRef, zoomTo]);

  // Touch (docs/spec/touch.md): one finger on empty canvas pans, as the mouse's drag does, and two
  // fingers pinch-zoom about the point between them. A pinch takes effect only once the fingers
  // have spread or closed past a small dead zone, so two fingers swiped together — the preset
  // cycle — do not jitter the zoom on the way.
  useEffect(() => {
    const el = svgRef.current;
    if (el === null) return;
    let pan: { x: number; y: number } | null = null;
    let pinch: { spread: number; scale: number } | null = null;

    const spreadOf = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const handleTouchStart = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (e.touches.length === 1 && a !== undefined && e.target === el) {
        pan = { x: a.clientX, y: a.clientY };
        pinch = null;
        return;
      }
      pan = null;
      pinch = e.touches.length === 2 && a !== undefined && b !== undefined
        ? { spread: spreadOf(a, b), scale: transform.current.scale }
        : null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (pan !== null && a !== undefined && e.touches.length === 1) {
        const next = { x: a.clientX, y: a.clientY };
        applyTransform({ ...transform.current, x: transform.current.x + next.x - pan.x, y: transform.current.y + next.y - pan.y });
        pan = next;
        return;
      }
      if (pinch === null || a === undefined || b === undefined || pinch.spread === 0) return;
      const spread = spreadOf(a, b);
      if (Math.abs(spread - pinch.spread) < PINCH_DEAD_ZONE_PX) return;
      zoomTo(pinch.scale * (spread / pinch.spread), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) { pan = null; pinch = null; }
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [svgRef, applyTransform, zoomTo]);

  const centerOnPoint = useCallback(
    (lx: number, ly: number) => {
      const { w, h } = size();
      const s = transform.current.scale;
      applyTransform({ x: w / 2 - lx * s, y: h / 2 - ly * s, scale: s });
    },
    [applyTransform, size],
  );

  const centerOnRoot = useCallback(() => centerOnPoint(0, 0), [centerOnPoint]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const cur = transform.current;
      applyTransform({ ...cur, x: cur.x + dx, y: cur.y + dy });
    },
    [applyTransform],
  );

  // Pans the *minimum* amount to bring `(lx, ly)` just inside the margin at whichever edge it escaped
  // (gentler than recentring — the node lands at the edge, not the middle).
  const ensureVisible = useCallback(
    (lx: number, ly: number) => {
      const { w, h } = size();
      const { x, y, scale } = transform.current;
      const sx = x + lx * scale;
      const sy = y + ly * scale;
      const m = VISIBLE_MARGIN;
      let nx = x;
      let ny = y;
      if (sx < m) nx = x + (m - sx);
      else if (sx > w - m) nx = x - (sx - (w - m));
      if (sy < m) ny = y + (m - sy);
      else if (sy > h - m) ny = y - (sy - (h - m));
      if (nx === x && ny === y) return; // already comfortably visible
      applyTransform({ x: nx, y: ny, scale });
    },
    [applyTransform, size],
  );

  const zoomIn = useCallback(() => {
    const { w, h } = size();
    zoomTo(transform.current.scale * ZOOM_STEP, w / 2, h / 2);
  }, [zoomTo, size]);

  const zoomOut = useCallback(() => {
    const { w, h } = size();
    zoomTo(transform.current.scale / ZOOM_STEP, w / 2, h / 2);
  }, [zoomTo, size]);

  const getViewport = useCallback((): Viewport => {
    const { w, h } = size();
    return { ...transform.current, width: w, height: h };
  }, [size]);

  return { springProps, onMouseDown, centerOnRoot, centerOnPoint, ensureVisible, panBy, zoomIn, zoomOut, getViewport };
}
