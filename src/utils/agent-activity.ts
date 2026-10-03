import type { AgentActivityCounts } from "@/api/mindmap";

/**
 * What the agents are doing on the **whole board**, as the top bar's agent status reads it: the
 * Agentic Tasks waiting on the user's **Review** — an agent idle until its question is answered —
 * the agentic waits on something else (CI, say), and the Agentic Tasks **On Agent**. Counted, so the
 * tooltip can say how many; the icons only say whether. The backend counts them with the board
 * load (`mindmap::rules::facts`); this is how the app holds them.
 */
export interface AgentActivity {
  /** Agentic Tasks that read Review: On Agent, with the agent's question open for the user. */
  review: number;
  /** Pending agentic waits on something other than the user — CI, say. */
  waits: number;
  /** Agentic Tasks an agent holds, with nothing asked of the user: On Agent. */
  onAgent: number;
}

export const NO_AGENT_ACTIVITY: AgentActivity = { review: 0, waits: 0, onAgent: 0 };

/** The activity the board load counted, or none when it sent none. */
export function agentActivityFrom(counts: AgentActivityCounts | undefined): AgentActivity {
  if (counts === undefined) return NO_AGENT_ACTIVITY;
  return { review: counts.review, waits: counts.waits, onAgent: counts.on_agent };
}
