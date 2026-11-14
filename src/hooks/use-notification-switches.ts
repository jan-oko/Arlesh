import { useCallback, useEffect, useState } from "react";
import { notificationSwitches, setNotificationEnabled } from "@/api/notifications";
import type { NotificationChannel, NotificationSwitch } from "@/api/notifications";
import { getErrorMessage } from "@/api/errors";

/** The desktop's notification switches, one per event, saved on this device as they change. */
export function useNotificationSwitches() {
  const [switches, setSwitches] = useState<NotificationSwitch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notificationSwitches()
      .then(setSwitches)
      .catch((err: unknown) => { setError(getErrorMessage(err)); });
  }, []);

  const toggle = useCallback((channel: NotificationChannel, enabled: boolean) => {
    setNotificationEnabled(channel, enabled)
      .then(() => {
        setError(null);
        setSwitches((current) =>
          current === null ? current : current.map((s) => (s.channel === channel ? { ...s, enabled } : s)),
        );
      })
      .catch((err: unknown) => { setError(getErrorMessage(err)); });
  }, []);

  return { switches, error, toggle };
}
