import { useCallback, useEffect, useState } from "react";
import { fetchMcpEndpointStatus, restartMcpEndpoint, setMcpPort } from "@/api/mcp-endpoint";
import type { McpEndpointStatus } from "@/api/mcp-endpoint";
import { getErrorMessage } from "@/api/errors";

export interface McpEndpoint {
  /** The listener's status, or `null` until it has been read. */
  status: McpEndpointStatus | null;
  /** Whether a restart or a port change is in flight. */
  isBusy: boolean;
  error: string | null;
  restart: () => Promise<void>;
  setPort: (port: number) => Promise<void>;
}

/**
 * The MCP endpoint's listener for the settings page: its status, a restart, and a port change.
 * Each action answers with the status it left behind, which replaces the one shown.
 */
export function useMcpEndpoint(): McpEndpoint {
  const [status, setStatus] = useState<McpEndpointStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<McpEndpointStatus>) => {
    setIsBusy(true);
    try {
      setStatus(await action());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }, []);

  // Fetching on mount is the effect's job; the state it sets arrives after the await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(fetchMcpEndpointStatus);
  }, [run]);

  const restart = useCallback(() => run(restartMcpEndpoint), [run]);
  const setPort = useCallback((port: number) => run(() => setMcpPort(port)), [run]);

  return { status, isBusy, error, restart, setPort };
}
