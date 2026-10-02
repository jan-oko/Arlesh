import type { MindmapNode } from "@/utils/tree-layout";
import { EXPECTATION_STATUS } from "@/api/expectation-status";
import { isOnAgent, isReview } from "@/utils/status-mapping";

/**
 * What the agents are doing on the **whole board**, as the top bar's agent status reads it: the
 * Agentic Tasks waiting on the user's **Review** — an agent idle until its question is answered —
 * the agentic waits on something else (CI, say), and the Agentic Tasks **On Agent**. Counted, so the
 * tooltip can say how many; the icons only say whether.
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

/** A wait an agent raised on something other than the user, still pending and in play. */
function isLiveAgentWait(node: MindmapNode): boolean {
  return node.kind === "expectation"
    && node.agentWaiting !== undefined
    && !node.agentWaiting.question
    && node.status === EXPECTATION_STATUS.PENDING
    && node.archived !== true;
}

/** Counts the agents' activity over `root` and everything under it. */
export function agentActivityOf(root: MindmapNode): AgentActivity {
  const counts = { ...NO_AGENT_ACTIVITY };
  const visit = (node: MindmapNode): void => {
    if (isLiveAgentWait(node)) counts.waits += 1;
    else if (node.kind === "task" && isReview(node.taskStatus)) counts.review += 1;
    else if (node.kind === "task" && isOnAgent(node.taskStatus)) counts.onAgent += 1;
    node.children.forEach(visit);
  };
  visit(root);
  return counts;
}
