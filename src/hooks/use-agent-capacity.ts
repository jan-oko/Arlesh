import { useCallback, useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { fetchAgentCapacity, onAgentCapacityChanged, setAgentCapacity } from "@/api/agent-capacity";
import { onBoardChanged } from "@/api/board";
import { getErrorMessage } from "@/api/errors";
import { useAgentCapacityStore } from "@/stores/use-agent-capacity-store";

/**
 * Keeps this window's copy of the agent capacity lock in step with the backend: reads it once, then
 * takes every change the backend announces — from this window, another, or an agent over the MCP.
 * Mounted once, at the app root: the lock is app-wide, not a tab's.
 */
export function useAgentCapacitySync(): void {
  useEffect(() => {
    const { receive, fail } = useAgentCapacityStore.getState();
    let subscribed = true;
    let unlisten: UnlistenFn | null = null;
    let unlistenBoard: UnlistenFn | null = null;

    void onAgentCapacityChanged((state) => receive(state.at_capacity)).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });
    // In Client mode the lock is the server's, and another device's change to it reaches this
    // window only as a board change: read it again then.
    void onBoardChanged(() => {
      fetchAgentCapacity()
        .then((state) => { if (subscribed) receive(state.at_capacity); })
        .catch(() => undefined);
    }).then((stop) => {
      if (subscribed) unlistenBoard = stop;
      else stop();
    });
    // Subscribed before the read, so a change landing between the two is never missed; the read
    // then only ever confirms or updates what the event said.
    fetchAgentCapacity()
      .then((state) => { if (subscribed) receive(state.at_capacity); })
      .catch((error: unknown) => { if (subscribed) fail(getErrorMessage(error)); });

    return () => {
      subscribed = false;
      unlisten?.();
      unlistenBoard?.();
    };
  }, []);
}

/** The agent capacity lock as a control reads and sets it. */
export interface AgentCapacity {
  /** Whether agents are at capacity. */
  atCapacity: boolean;
  /** The last failure to read or set the lock, or `null`. */
  error: string | null;
  /** Sets the lock on or off. A failure is recorded in `error`, never thrown. */
  setAtCapacity: (atCapacity: boolean) => Promise<void>;
}

/** The agent capacity lock, for the Settings switch and the top-bar indicator. */
export function useAgentCapacity(): AgentCapacity {
  const atCapacity = useAgentCapacityStore((s) => s.atCapacity);
  const error = useAgentCapacityStore((s) => s.error);
  const receive = useAgentCapacityStore((s) => s.receive);
  const fail = useAgentCapacityStore((s) => s.fail);

  const set = useCallback(async (next: boolean) => {
    try {
      receive((await setAgentCapacity(next)).at_capacity);
    } catch (err: unknown) {
      fail(getErrorMessage(err));
    }
  }, [receive, fail]);

  return { atCapacity, error, setAtCapacity: set };
}
