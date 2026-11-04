/**
 * How the app sits against the Android system bars (decided with the user, 2026-11-02):
 * `standard` keeps the bars visible and opaque with the app below the status bar; `edgeToEdge`
 * keeps them visible but transparent, the app drawn under them and padded by their size;
 * `immersive` hides them (a swipe from the edge peeks them) and uses the whole screen.
 */
export type SystemBarsMode = "standard" | "edgeToEdge" | "immersive";

export const SYSTEM_BARS_MODES: readonly SystemBarsMode[] = ["standard", "edgeToEdge", "immersive"];

export function isSystemBarsMode(value: string): value is SystemBarsMode {
  return SYSTEM_BARS_MODES.some((mode) => mode === value);
}

/** Which of the two settings applies right now: fullscreen has its own. */
export function systemBarsFor(
  isFullscreen: boolean,
  settings: { systemBars: SystemBarsMode; systemBarsFullscreen: SystemBarsMode },
): SystemBarsMode {
  return isFullscreen ? settings.systemBarsFullscreen : settings.systemBars;
}
