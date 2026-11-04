import { useClientModeStore } from "@/stores/use-client-mode-store";
import type { ModeStatus, ReadOnlyReason } from "@/api/client-mode";

/** Why the board cannot be written under `status`, or `null`. Standalone is never read-only. */
export function readOnlyReasonOf(status: ModeStatus | null): ReadOnlyReason | null {
  return status?.mode === "client" ? status.server?.read_only ?? null : null;
}

/** Why the board cannot be written right now, read at this instant — for a handler, not a render. */
export function currentReadOnlyReason(): ReadOnlyReason | null {
  return readOnlyReasonOf(useClientModeStore.getState().status);
}

/**
 * Why the board cannot be written right now, or `null` when it can: in Client mode, the server is
 * unreachable or speaks another API version (docs/spec/client-mode.md). The touch surfaces grey out
 * their writes on it rather than letting them fail.
 */
export function useBoardReadOnly(): ReadOnlyReason | null {
  return useClientModeStore((s) => readOnlyReasonOf(s.status));
}
