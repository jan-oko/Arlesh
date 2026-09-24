import { create } from "zustand";

interface McpAccessStore {
  /**
   * Bumped whenever this window changes the MCP roots. Every open view's board reload watches it,
   * so the "visible to the MCP" badges follow a root the moment it is added or removed. Other
   * windows are told by the ordinary board-changed event, like any other edit.
   */
  revision: number;
  rootsChanged: () => void;
}

/** App-wide and unpersisted: a signal, not a setting. The roots themselves live in the database. */
export const useMcpAccessStore = create<McpAccessStore>()((set) => ({
  revision: 0,
  rootsChanged: () => set((state) => ({ revision: state.revision + 1 })),
}));
