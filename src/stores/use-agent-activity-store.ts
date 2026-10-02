import { create } from "zustand";
import type { AgentActivity } from "@/utils/agent-activity";
import { NO_AGENT_ACTIVITY } from "@/utils/agent-activity";

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
}

export const useAgentActivityStore = create<AgentActivityStore>()((set) => ({
  activity: NO_AGENT_ACTIVITY,
  receive: (activity) => set({ activity }),
}));
