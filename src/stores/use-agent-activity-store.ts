import { create } from "zustand";
import type { AgentActivity } from "@/utils/agent-activity";
import { NO_AGENT_ACTIVITY } from "@/utils/agent-activity";
import type { RowId } from "@/api/node-id";

/**
 * The agents' activity on the whole board, as the latest load counted it (`agent-activity`).
 *
 * App-wide rather than a tab's: every tab reads one board. Pushed by `use-mindmap-data` after each
 * load — every edit, every other window's change and every MCP write ends in one — so the top bar
 * holds no board of its own and makes no request of its own.
 */
interface AgentActivityStore {
  activity: AgentActivity;
  receive: (activity: AgentActivity) => void;
  /** The waits with a staged answer on the whole board (ADR 0021): what one Send sends. */
  stagedWaitIds: readonly RowId[];
  receiveStaged: (ids: readonly RowId[]) => void;
}

export const useAgentActivityStore = create<AgentActivityStore>()((set) => ({
  activity: NO_AGENT_ACTIVITY,
  receive: (activity) => set({ activity }),
  stagedWaitIds: [],
  receiveStaged: (ids) => set((state) => (sameIds(state.stagedWaitIds, ids) ? state : { stagedWaitIds: ids })),
}));

function sameIds(a: readonly RowId[], b: readonly RowId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
