import { useCallback, useSyncExternalStore } from "react";

/**
 * The phone layout's breakpoint: below 700 px wide (see `docs/spec/touch.md`). The CSS modules
 * repeat it as `@media (max-width: 699.98px)`, since a custom property cannot name a breakpoint.
 */
export const PHONE_LAYOUT_QUERY = "(max-width: 699.98px)";

/** A touchscreen is present, whatever else is: the gestures switch on. */
export const TOUCH_QUERY = "(any-pointer: coarse)";

/** Touch is the only pointer: no mouse or trackpad to reach what the layout hides. */
export const TOUCH_ONLY_QUERY = "(any-pointer: coarse) and (not (any-pointer: fine))";

/** The media query list for `query`, or `null` where the platform has none (jsdom, old webviews). */
function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/**
 * Whether a CSS media query matches, following it as it changes — a window resized, a keyboard or
 * a mouse docked. Reads `false` where the platform has no `matchMedia`, so a test environment gets
 * the desktop layout unless it says otherwise.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = mediaQueryList(query);
    if (list === null) return () => undefined;
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  const read = useCallback(() => mediaQueryList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** The width axis: the window is narrow enough for the phone layout. */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_LAYOUT_QUERY);
}

/** The touch axis: a touchscreen is present, so the gestures apply. */
export function useHasTouch(): boolean {
  return useMediaQuery(TOUCH_QUERY);
}

/**
 * Whether the touch layout is on: the top bar, the action bar and the bottom navigation, with no
 * tab strip (`docs/spec/touch.md`). It follows the pointer alone, never the window's width, so a
 * phone in landscape keeps it and a narrow desktop window with a mouse does not.
 */
export function useTouchLayout(): boolean {
  return useMediaQuery(TOUCH_ONLY_QUERY);
}
