import { useSpring, type SpringValues } from "@react-spring/web";
import { useCallback, useEffect, useRef } from "react";

interface Transform {
  x: number;
  y: number;
  scale: number;
}

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
  zoomIn: () => void;
  zoomOut: () => void;
  /** Current transform + measured viewport size (read on demand). */
  getViewport: () => Viewport;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;
const ZOOM_STEP = 1.2; // per Ctrl+= / Ctrl+-
/** Screen-px margin: a selected node closer than this to an edge is treated as off-screen. */
const VISIBLE_MARGIN = 100;

export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>): PanZoomResult {
  const initialX = window.innerWidth / 2;
  const initialY = window.innerHeight / 2;

  const transform = useRef<Transform>({ x: initialX, y: initialY, scale: 1 });
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

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

  const centerOnPoint = useCallback(
    (lx: number, ly: number) => {
      const { w, h } = size();
      const s = transform.current.scale;
      applyTransform({ x: w / 2 - lx * s, y: h / 2 - ly * s, scale: s });
    },
    [applyTransform, size],
  );

  const centerOnRoot = useCallback(() => centerOnPoint(0, 0), [centerOnPoint]);

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

  return { springProps, onMouseDown, centerOnRoot, centerOnPoint, ensureVisible, zoomIn, zoomOut, getViewport };
}
