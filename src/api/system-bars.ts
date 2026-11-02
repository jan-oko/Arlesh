import type { SystemBarsMode } from "@/utils/system-bars";

/** The Android activity's bridge (`SystemBarsBridge.kt`), injected into the page as `ArleshBars`. */
interface SystemBarsBridge {
  setSystemBars: (mode: string, darkTheme: boolean) => void;
}

function isBridge(value: unknown): value is SystemBarsBridge {
  return (
    typeof value === "object" &&
    value !== null &&
    "setSystemBars" in value &&
    typeof value.setSystemBars === "function"
  );
}

/**
 * Tells the Android activity how to sit against the system bars, and whether the app is dark (the
 * status-bar icons are light on dark). The activity answers by pushing the real insets into the
 * page's `--sat`/`--sab`/`--sal`/`--sar`. Does nothing where there is no bridge: the desktop, a
 * browser, a test.
 */
export function setSystemBars(mode: SystemBarsMode, darkTheme: boolean): void {
  const bridge: unknown = Reflect.get(window, "ArleshBars");
  if (isBridge(bridge)) bridge.setSystemBars(mode, darkTheme);
}
