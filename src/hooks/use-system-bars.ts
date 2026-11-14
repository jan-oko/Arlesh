import { useEffect } from "react";
import { setSystemBars } from "@/api/system-bars";
import { useDisplayStore } from "@/stores/use-display-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { systemBarsFor } from "@/utils/system-bars";

/**
 * Keeps the Android activity in the wanted mode: the setting for normal display, or the one for
 * fullscreen while the app is in it (leaving fullscreen restores the first). Runs on mount too,
 * which is what re-applies the insets after the page loads.
 */
export function useSystemBars(): void {
  const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
  const systemBars = useDisplayStore((s) => s.systemBars);
  const systemBarsFullscreen = useDisplayStore((s) => s.systemBarsFullscreen);
  const dark = useThemeStore((s) => s.theme === "dark");
  const mode = systemBarsFor(isFullscreen, { systemBars, systemBarsFullscreen });

  useEffect(() => {
    const bridged = setSystemBars(mode, dark);
    // Full screen hides the top and bottom bars, so the views pad for the system bars themselves:
    // by the visible insets (Edge-to-edge) or where the hidden ones peek (Immersive). Standard
    // pads in the activity, and with no bridge there are no bars.
    const root = document.documentElement;
    if (bridged && isFullscreen && mode !== "standard") root.dataset.fsBars = mode;
    else delete root.dataset.fsBars;
    // The Full screen corners count to the layout around the camera, which re-reads on this.
    window.dispatchEvent(new Event("arlesh-insets"));
  }, [mode, dark, isFullscreen]);
}
