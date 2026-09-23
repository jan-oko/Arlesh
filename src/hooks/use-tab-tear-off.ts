import { useCallback, useEffect, useMemo, useRef } from "react";
import { traceDrag } from "@/utils/drag-trace";

/**
 * How long the window a tab was dragged out of waits, after the drag ends, for another window to
 * ask for it before tearing it off into a window of its own.
 *
 * A drop on another window reaches this one as a claim, which crosses two processes and the
 * backend — tens of milliseconds, not hundreds. A claim that is later still finds the tab in a
 * window of its own and does nothing, so the cost of a slow one is a tab that ended up in a new
 * window rather than two copies of it.
 */
export const TEAR_OFF_GRACE_MS = 700;

/** The window's side of a tab drag, as the strip reports it. */
export interface TabTearOff {
  /** A drag began here. */
  started: () => void;
  /** The drag was dropped on this window — a reorder, or nothing. */
  landedHere: () => void;
  /** The drag has ended. Unless it landed here or was claimed, the tab is torn off shortly. */
  ended: (tabId: string) => void;
  /** Another window asked for the tab: it is moving there, not becoming a window. */
  claimed: (tabId: string) => void;
}

/**
 * Decides when a tab dragged out of this window becomes a window of its own.
 *
 * **Not from the drag's `dropEffect`**, which is what a browser offers for the question and what
 * cannot be trusted on Wayland. GTK 3 reports the last action a destination agreed to and never
 * resets it when a drag is cancelled (`data_source_cancelled` in `gdkselection-wayland.c`), and
 * Hyprland sends the source nothing when the pointer leaves a surface. Every tab drag starts over
 * its own window, which accepts it — so a drag released over the desktop still ends reporting
 * `"move"`, and a tear-off keyed on `"none"` never happens.
 *
 * So the answer comes from what the app itself saw. A drop on this window is seen here directly. A
 * drop on another window is seen as that window's **claim** for the tab. A drag that ended with
 * neither — within {@link TEAR_OFF_GRACE_MS} of its end — was released over no Arlesh window, and
 * that is the tear-off. Escape pressed mid-drag reads the same way, since nothing tells the page a
 * drag was cancelled rather than released.
 */
export function useTabTearOff(tearOff: (tabId: string) => void): TabTearOff {
  const latestTearOff = useRef(tearOff);
  useEffect(() => {
    latestTearOff.current = tearOff;
  }, [tearOff]);

  const landed = useRef(false);
  const claimedIds = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const started = useCallback(() => {
    landed.current = false;
    claimedIds.current.clear();
  }, []);

  const landedHere = useCallback(() => {
    landed.current = true;
  }, []);

  const claimed = useCallback((tabId: string) => {
    const timer = timers.current.get(tabId);
    if (timer === undefined) {
      // The claim overtook the end of the drag: remember it for when the drag ends.
      claimedIds.current.add(tabId);
      return;
    }
    clearTimeout(timer);
    timers.current.delete(tabId);
    traceDrag("tear-off cancelled by a claim", { tabId });
  }, []);

  const ended = useCallback((tabId: string) => {
    const wasClaimed = claimedIds.current.delete(tabId);
    if (landed.current || wasClaimed) return;
    traceDrag("tear-off pending", { tabId, graceMs: TEAR_OFF_GRACE_MS });
    timers.current.set(
      tabId,
      setTimeout(() => {
        timers.current.delete(tabId);
        traceDrag("tear-off", { tabId });
        latestTearOff.current(tabId);
      }, TEAR_OFF_GRACE_MS),
    );
  }, []);

  return useMemo(() => ({ started, landedHere, ended, claimed }), [started, landedHere, ended, claimed]);
}
