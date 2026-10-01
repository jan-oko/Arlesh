import type { MindmapNode } from "@/utils/tree-layout";
import { isAgentic } from "@/utils/agentic";
import { EXPECTATION_STATUS } from "@/api/expectation-status";

/**
 * What the agents are doing on the **whole board**, as the top bar's agent status reads it: the
 * agentic waits still pending — questions for the user apart from waits on something else — and
 * the Agentic Tasks In Progress. Counted, so the tooltip can say how many; the icons only say
 * whether.
 */
export interface AgentActivity {
  /** Pending agentic waits that ask the user something ("the agent is waiting on you"). */
  questions: number;
  /** Pending agentic waits on something other than the user — CI, say. */
  waits: number;
  /** Tasks that read as Agentic and are In Progress. */
  inProgress: number;
}

export const NO_AGENT_ACTIVITY: AgentActivity = { questions: 0, waits: 0, inProgress: 0 };

/** A wait an agent raised that is still pending and in play. */
function isLiveAgentWait(node: MindmapNode): node is MindmapNode & { agentWaiting: NonNullable<MindmapNode["agentWaiting"]> } {
  return node.kind === "expectation"
    && node.agentWaiting !== undefined
    && node.status === EXPECTATION_STATUS.PENDING
    && node.archived !== true;
}

/**
 * Counts the agents' activity over `root` and everything under it. Reads a tree whose inherited
 * Agentic has already been resolved (`propagateAgentic`), as every loaded board's is.
 */
export function agentActivityOf(root: MindmapNode): AgentActivity {
  const counts = { ...NO_AGENT_ACTIVITY };
  const visit = (node: MindmapNode): void => {
    if (isLiveAgentWait(node)) {
      if (node.agentWaiting.question) counts.questions += 1;
      else counts.waits += 1;
    } else if (node.status === "in_progress" && isAgentic(node)) {
      counts.inProgress += 1;
    }
    node.children.forEach(visit);
  };
  visit(root);
  return counts;
}
