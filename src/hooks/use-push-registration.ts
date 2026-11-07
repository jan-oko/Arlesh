import { useEffect } from "react";
import { PUSH_TOKEN_EVENT, pushBridge, registerPush } from "@/api/push";
import { useClientModeStore } from "@/stores/use-client-mode-store";

/**
 * Keeps this phone's FCM token registered with the server: on each start in Client mode, when the
 * build can receive push and the user has allowed notifications, and again whenever FCM rotates the
 * token. Does nothing elsewhere. Nothing here asks for the permission: that is Settings →
 * Notifications.
 */
export function usePushRegistration(): void {
  const isClient = useClientModeStore((s) => s.status?.mode === "client");

  useEffect(() => {
    const bridge = pushBridge();
    if (!isClient || bridge === null || !bridge.available()) return;

    const onToken = (event: Event): void => {
      const token = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : "";
      if (token === "" || !bridge.allowed()) return;
      registerPush(token).catch((error: unknown) => {
        console.warn("[arlesh] could not register for push notifications:", error);
      });
    };
    window.addEventListener(PUSH_TOKEN_EVENT, onToken);
    if (bridge.allowed()) bridge.fetchToken();
    return () => { window.removeEventListener(PUSH_TOKEN_EVENT, onToken); };
  }, [isClient]);
}
