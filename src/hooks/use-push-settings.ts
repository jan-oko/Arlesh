import { useCallback, useEffect, useState } from "react";
import { pushBridge, pushState } from "@/api/push";
import type { PushState } from "@/api/push";
import { getErrorMessage } from "@/api/errors";

/** What Settings → Notifications can say about push on this device. */
export type PushStatus =
  | "loading"
  | "unsupported" // this build has no Firebase configuration
  | "serverOff" // the server has no FCM credentials
  | "blocked" // Android notifications are not allowed for Arlesh
  | "ready";

export function usePushSettings() {
  const [server, setServer] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean>(() => pushBridge()?.allowed() ?? false);

  const refresh = useCallback(() => {
    setAllowed(pushBridge()?.allowed() ?? false);
  }, []);

  useEffect(() => {
    pushState()
      .then(setServer)
      .catch((err: unknown) => { setError(getErrorMessage(err)); });
    // The permission dialog and the system settings both pause the app; the answer is read on return.
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const bridge = pushBridge();
  let status: PushStatus = "loading";
  if (bridge === null || !bridge.available()) status = "unsupported";
  else if (server !== null && !server.enabled) status = "serverOff";
  else if (server !== null) status = allowed ? "ready" : "blocked";

  return {
    status,
    error,
    requestPermission: () => { pushBridge()?.requestPermission(); },
    openSystemSettings: () => { pushBridge()?.openSettings(); },
  };
}
