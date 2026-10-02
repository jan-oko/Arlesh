import { create } from "zustand";

/**
 * This window's copy of the **agent capacity lock** (see `src/api/agent-capacity.ts`).
 *
 * Not persisted: the backend holds the lock, shared with every window and the MCP, and this copy is
 * only what the window last heard. Off until the first read lands, so a window that never hears
 * hides nothing.
 */
interface AgentCapacityStore {
  /** Whether agents are at capacity, as this window last heard. */
  atCapacity: boolean;
  /** The last failure to read or set the lock, or `null`. */
  error: string | null;
  /** Records the lock's state as the backend answered or announced it. */
  receive: (atCapacity: boolean) => void;
  /** Records a failure to read or set the lock. */
  fail: (message: string) => void;
}

export const useAgentCapacityStore = create<AgentCapacityStore>()((set) => ({
  atCapacity: false,
  error: null,
  receive: (atCapacity) => set({ atCapacity, error: null }),
  fail: (message) => set({ error: message }),
}));
