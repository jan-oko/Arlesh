import { useSpring, type SpringValues } from "@react-spring/web";
import { useGesture } from "@use-gesture/react";
import { useCallback, useRef } from "react";

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface PanZoomResult {
  springProps: SpringValues<Transform>;
  bind: ReturnType<typeof useGesture>;
  resetTransform: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;

export function usePanZoom(): PanZoomResult {
  const transform = useRef<Transform>({ x: 0, y: 0, scale: 1 });

  const [springProps, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, config: { tension: 300, friction: 30 } }));

  const applyTransform = useCallback(
    (next: Transform) => {
      transform.current = next;
      api.start({ x: next.x, y: next.y, scale: next.scale });
    },
    [api],
  );

  const bind = useGesture({
    onDrag: ({ delta: [dx, dy], buttons }) => {
      // Pan on middle-click drag or space+drag (buttons & 4 = middle button)
      if (!(buttons & 4)) return;
      applyTransform({
        ...transform.current,
        x: transform.current.x + dx,
        y: transform.current.y + dy,
      });
    },
    onWheel: ({ delta: [, dy], event }) => {
      event.preventDefault();
      const delta = -dy * WHEEL_SENSITIVITY;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.current.scale + delta));
      applyTransform({ ...transform.current, scale: next });
    },
    onPinch: ({ offset: [scale] }) => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      applyTransform({ ...transform.current, scale: clamped });
    },
  });

  const resetTransform = useCallback(() => {
    applyTransform({ x: 0, y: 0, scale: 1 });
  }, [applyTransform]);

  return { springProps, bind, resetTransform };
}
