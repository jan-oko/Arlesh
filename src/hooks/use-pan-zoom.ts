import { useSpring, type SpringValues } from "@react-spring/web";
import { useCallback, useEffect, useRef } from "react";

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface PanZoomResult {
  springProps: SpringValues<Transform>;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  centerOnRoot: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;

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

  // Wheel must be registered imperatively with passive:false so preventDefault works
  useEffect(() => {
    const el = svgRef.current;
    if (el === null) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * WHEEL_SENSITIVITY;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.current.scale + delta));
      const ratio = newScale / transform.current.scale;
      applyTransform({
        x: e.clientX - (e.clientX - transform.current.x) * ratio,
        y: e.clientY - (e.clientY - transform.current.y) * ratio,
        scale: newScale,
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [svgRef, applyTransform]);

  const centerOnRoot = useCallback(() => {
    applyTransform({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scale: transform.current.scale,
    });
  }, [applyTransform]);

  return { springProps, onMouseDown, centerOnRoot };
}
