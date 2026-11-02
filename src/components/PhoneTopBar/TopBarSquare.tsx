import { useEffect, useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { runFirst } from "@/hooks/use-view-gestures";
import { usePaletteStore } from "@/stores/use-palette-store";
import { LONG_PRESS_MS, TAP_SLOP_PX } from "@/utils/touch/gestures";
import styles from "./PhoneTopBar.module.css";

/** `Ctrl+O`, the node search that re-roots the tab. */
const OPEN_COMMAND_IDS: readonly string[] = ["global.openSearch"];

/** A coordinate, or 0 where the platform gave none. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * The free square at the end of the phone top bar (`docs/spec/touch.md`): a **tap** opens
 * Open (`Ctrl+O`'s node search) and a **long-press** opens the command palette, once the finger
 * lifts as a node's long-press does. A tap is a press and lift on the square within the tap slop
 * and the long-press time; the square takes the pointer (and `touch-action: none`) so the browser
 * never turns a jittery tap into a pan and cancels it.
 */
export default function TopBarSquare() {
  const { t } = useTranslation("touch");
  const openPalette = usePaletteStore((s) => s.open);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  // The press in progress: where it began and which pointer made it. Null when none is.
  // A press that drifts further than the tap slop is cancelled by *distance*, not by leaving the
  // square: a thumb rolls a few px while it lifts, and that must not cost the tap.
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  function clearHold() {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  useEffect(() => clearHold, []);

  function endPress() {
    clearHold();
    press.current = null;
    held.current = false;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    clearHold();
    press.current = { pointerId: event.pointerId, x: finite(event.clientX), y: finite(event.clientY) };
    held.current = false;
    // Keep the rest of the gesture on the square, whatever the finger does, so the lift always
    // reaches it. (Absent in jsdom.)
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* an inactive pointer */ }
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      held.current = true;
      if (typeof navigator.vibrate === "function") navigator.vibrate(10);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = press.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    const moved = Math.hypot(finite(event.clientX) - start.x, finite(event.clientY) - start.y);
    if (moved > TAP_SLOP_PX) endPress();
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = press.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    const moved = Math.hypot(finite(event.clientX) - start.x, finite(event.clientY) - start.y);
    const wasHeld = held.current;
    endPress();
    if (moved > TAP_SLOP_PX) return;
    if (wasHeld) openPalette();
    else runFirst(OPEN_COMMAND_IDS);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.square}
      aria-label={t("topBarSquare")}
      title={t("topBarSquare")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPress}
      // The browser follows a tap with a synthesized mousedown and click at the same spot. By then
      // Open's overlay is under the finger, and that click would close it again (or its mousedown
      // take the focus off the search box, dropping the keyboard). Cancelling the touch stops them.
      onTouchEnd={(event) => { if (event.cancelable) event.preventDefault(); }}
      onKeyDown={(event) => { if (event.key === "Enter") runFirst(OPEN_COMMAND_IDS); }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
