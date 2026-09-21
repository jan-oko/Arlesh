import { useCallback, useEffect } from "react";
import { quitApp, setCloseToTray } from "@/api/tray";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";

const LOG_PREFIX = "[arlesh]";

/**
 * Keeps the backend's copy of the close-to-tray setting in step with the stored one.
 *
 * The setting is persisted in the browser, where the user changes it, but acted on in Rust, where
 * the window's close button is answered — so one of the two has to tell the other. Mounted once,
 * at the app root: this is an app preference, not a tab's.
 *
 * A failed push is logged and nothing else. The backend then keeps whatever it last heard, the
 * close button goes on meaning that, and the next toggle tries again.
 */
export function useCloseToTraySync(): void {
  const closeToTray = useCloseToTrayStore((s) => s.closeToTray);

  useEffect(() => {
    setCloseToTray(closeToTray).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} could not tell the backend about close-to-tray:`, error);
    });
  }, [closeToTray]);
}

/**
 * The action behind Ctrl+Q: end Arlesh, rather than hide it.
 *
 * Nothing waits on it — the process goes before the call could resolve — so a rejection is the only
 * thing there is to report, and it means the app is still running.
 */
export function useQuit(): () => void {
  return useCallback(() => {
    quitApp().catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} could not quit:`, error);
    });
  }, []);
}
