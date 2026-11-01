import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { fetchModeStatus, onServerStatusChanged } from "@/api/client-mode";
import { setGestureBracketing } from "@/api/gesture";
import { isClientMode, useClientModeStore } from "@/stores/use-client-mode-store";

/**
 * Keeps this window's copy of the mode and the server's status current: reads it once, then takes
 * every status change the backend announces. Mounted once, at the app root.
 */
export function useClientModeSync(): void {
  useEffect(() => {
    const { receive, receiveServer } = useClientModeStore.getState();
    let subscribed = true;
    let unlisten: UnlistenFn | null = null;

    void onServerStatusChanged(receiveServer).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });
    fetchModeStatus()
      .then((status) => {
        if (!subscribed) return;
        receive(status);
        // A Client's Gesture brackets send nothing, so they are not worth a trip each.
        setGestureBracketing(!isClientMode(status));
      })
      .catch((error: unknown) => { console.warn("[arlesh] could not read the mode:", error); });

    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, []);
}
