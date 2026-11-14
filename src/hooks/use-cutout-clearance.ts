import { useEffect, type RefObject } from "react";
import { hasCutout, readCutoutBands, writeClearance, type CutoutBands } from "@/utils/cutout";

/** The window event the Android activity fires after it has pushed new insets (`MainActivity.kt`). */
const INSETS_EVENT = "arlesh-insets";

/** The bands now: the cutout's, plus the screen's corners where the page is in Full screen. */
function currentBands(): CutoutBands {
  const root = document.documentElement;
  return readCutoutBands(root.style, { width: window.innerWidth, height: window.innerHeight }, root.dataset.fsBars !== undefined);
}

/** Calls `onChange` when the insets or the window's size change; returns what stops it. */
function onInsetsChange(onChange: () => void): () => void {
  window.addEventListener(INSETS_EVENT, onChange);
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener(INSETS_EVENT, onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * Keeps one element's `--clear-left|right|top|bottom` current: how far its content must stay in
 * from each edge to clear the display cutout (`utils/cutout.ts`). For a bar that spans the screen;
 * `present` is false while the element is not rendered, so the effect runs again when it appears.
 */
export function useCutoutClearance(ref: RefObject<HTMLElement | null>, present = true): void {
  useEffect(() => {
    if (!present) return;
    const apply = () => {
      if (ref.current !== null) writeClearance(ref.current, currentBands());
    };
    apply();
    return onInsetsChange(apply);
  }, [ref, present]);
}

/** Selects the elements `useRowCutoutClearance` keeps clear: a list row, a Plan or Steps card. */
export const CUTOUT_ROW_SELECTOR = "[data-cutout-row]";

/**
 * Keeps `--clear-left|right|top|bottom` current on every `[data-cutout-row]` inside a container, as
 * the rows scroll past the camera, the list changes and the insets change. Only a row that overlaps
 * the cutout's span ends up with a clearance; with no cutout nothing is measured at all.
 */
export function useRowCutoutClearance(ref: RefObject<HTMLElement | null>, scope: string): void {
  useEffect(() => {
    const container = ref.current;
    if (container === null) return;
    let frame = 0;
    // Whether rows may carry a clearance: with no cutout, rows are cleared once and then left be.
    let written = false;
    const apply = () => {
      frame = 0;
      const bands = currentBands();
      if (!hasCutout(bands) && !written) return;
      written = hasCutout(bands);
      for (const row of container.querySelectorAll<HTMLElement>(CUTOUT_ROW_SELECTOR)) writeClearance(row, bands);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    const stopInsets = onInsetsChange(schedule);
    // Scroll does not bubble, so it is caught on the way down: any scroller inside will do.
    container.addEventListener("scroll", schedule, true);
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      stopInsets();
      container.removeEventListener("scroll", schedule, true);
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ref, scope]);
}
