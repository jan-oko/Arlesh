import { useCallback, useEffect, useState } from "react";
import { listDevices } from "@/api/devices";
import type { Device } from "@/api/devices";
import { getErrorMessage } from "@/api/errors";

/** The server's devices, loaded when the page opens and again on `reload`. */
export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setDevices(await listDevices());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetching on mount is the effect's job; the state it sets arrives after the await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { devices, error, isLoading, reload };
}
