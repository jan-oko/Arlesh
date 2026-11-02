import { useEffect, useRef } from "react";
import { isThreeFingerTap } from "@/utils/touch/gestures";

/** One touch session: from the first finger down to the last finger up. */
interface Session {
  startedAt: number;
  /** When the third finger was down, or null while fewer than three have been. */
  thirdAt: number | null;
  /** The most fingers that were down together. */
  fingers: number;
  /** Where each finger first went down, by its identifier. */
  origins: Map<number, { x: number; y: number }>;
  farthest: number;
}

function isTouchEvent(event: Event): event is TouchEvent {
  return "touches" in event && "changedTouches" in event;
}

/**
 * Calls `onTap` when three fingers tap the screen together, anywhere in the document: over a
 * view, the top or bottom bar, a sheet or a menu. It listens on the whole document, in the capture
 * phase, rather than on a view's container, so it is armed in every view and whichever finger lands
 * where.
 *
 * Fingers never land or lift at the same instant, so the touch is judged as a whole: the most
 * fingers down together, how far any strayed, and how long it all took (`isThreeFingerTap`). It is
 * judged only once the last finger is up. When it is a tap, the final `touchend` is stopped before
 * it reaches a view, so no one-finger tap, press or click is read from the fingers of the three.
 */
export function useThreeFingerTap(onTap: () => void, enabled: boolean): void {
  const latest = useRef(onTap);
  useEffect(() => {
    latest.current = onTap;
  });

  useEffect(() => {
    if (!enabled) return;
    let session: Session | null = null;

    function onStart(event: TouchEvent) {
      if (session === null || event.touches.length === 1) {
        session = { startedAt: event.timeStamp, thirdAt: null, fingers: 0, origins: new Map(), farthest: 0 };
      }
      const current = session;
      current.fingers = Math.max(current.fingers, event.touches.length);
      if (current.fingers >= 3 && current.thirdAt === null) current.thirdAt = event.timeStamp;
      for (let index = 0; index < event.touches.length; index += 1) {
        const touch = event.touches[index];
        if (touch !== undefined && !current.origins.has(touch.identifier ?? index)) {
          current.origins.set(touch.identifier ?? index, { x: touch.clientX, y: touch.clientY });
        }
      }
    }

    function onMove(event: TouchEvent) {
      if (session === null) return;
      for (let index = 0; index < event.touches.length; index += 1) {
        const touch = event.touches[index];
        const origin = touch === undefined ? undefined : session.origins.get(touch.identifier ?? index);
        if (touch !== undefined && origin !== undefined) {
          session.farthest = Math.max(session.farthest, Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y));
        }
      }
    }

    function onEnd(event: TouchEvent) {
      if (session === null || event.touches.length > 0) return;
      const finished = session;
      session = null;
      if (finished.thirdAt === null) return;
      const tapped = isThreeFingerTap(
        finished.fingers, finished.farthest,
        event.timeStamp - finished.startedAt, finished.thirdAt - finished.startedAt,
      );
      if (!tapped) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      latest.current();
    }

    function onCancel() {
      session = null;
    }

    const listeners: ReadonlyArray<[string, (event: Event) => void]> = [
      ["touchstart", (event) => { if (isTouchEvent(event)) onStart(event); }],
      ["touchmove", (event) => { if (isTouchEvent(event)) onMove(event); }],
      ["touchend", (event) => { if (isTouchEvent(event)) onEnd(event); }],
      ["touchcancel", onCancel],
    ];
    // Capture, passive: it only watches, except to stop the last lift of a tap it recognised.
    for (const [type, listener] of listeners) document.addEventListener(type, listener, { capture: true, passive: type !== "touchend" });
    return () => {
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, { capture: true });
    };
  }, [enabled]);
}
