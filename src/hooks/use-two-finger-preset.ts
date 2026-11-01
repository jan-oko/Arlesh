import { useEffect, useRef } from "react";
import { useHasTouch } from "@/hooks/use-media-query";
import { usePresetChoice } from "@/hooks/use-preset-choice";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { classifyTwoFingerSwipe, type TouchSample, type TwoFingers } from "@/utils/touch/gestures";

/** Where a refusal toast is anchored when no node is concerned. */
const PRESET_TOAST_ANCHOR = "preset";

function fingers(touches: TouchList, time: number): TwoFingers | null {
  const [a, b] = [touches[0], touches[1]];
  if (a === undefined || b === undefined) return null;
  const at = (touch: Touch): TouchSample => ({ x: touch.clientX, y: touch.clientY, t: time });
  return [at(a), at(b)];
}

/**
 * A two-finger swipe cycles the preset, in every view (`docs/spec/touch.md`): left to the next, as a
 * page turns, right to the previous. In a view that locks its preset the swipe says why, as the
 * preset keys do there.
 */
export function useTwoFingerPreset(): void {
  const hasTouch = useHasTouch();
  const choice = usePresetChoice();
  const showToast = useMindmapStore((s) => s.showToast);
  const latest = useRef({ choice, showToast });
  useEffect(() => {
    latest.current = { choice, showToast };
  });

  useEffect(() => {
    if (!hasTouch) return;
    let start: TwoFingers | null = null;
    let last: TwoFingers | null = null;

    function onTouchStart(event: TouchEvent) {
      start = event.touches.length === 2 ? fingers(event.touches, event.timeStamp) : null;
      last = start;
    }
    function onTouchMove(event: TouchEvent) {
      if (start !== null && event.touches.length === 2) last = fingers(event.touches, event.timeStamp);
    }
    function onTouchEnd() {
      if (start === null || last === null) return;
      const direction = classifyTwoFingerSwipe(start, last);
      start = null;
      last = null;
      if (direction === null) return;
      const { choice: current, showToast: toast } = latest.current;
      if (current.lockedReason !== null) {
        toast({ nodeId: PRESET_TOAST_ANCHOR, message: current.lockedReason });
        return;
      }
      current.cycle(direction === "left" ? 1 : -1);
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [hasTouch]);
}
