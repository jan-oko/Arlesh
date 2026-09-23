import type { AgentDelegate, Delegate } from "@/api/tasks";

/** The one Agent target a Task can be delegated to. */
export const AGENT_DELEGATE: AgentDelegate = { kind: "agent" };

/** Whether `delegate` is the Agent. Absent and `null` both mean nobody holds the Task. */
export function isDelegatedToAgent(delegate: Delegate | null | undefined): boolean {
  return delegate?.kind === "agent";
}

/**
 * The delegate one press of the one-click delegate button leaves: the Agent is taken back to
 * nobody, and anything else — nobody, or a Person — becomes the Agent.
 */
export function toggledAgentDelegate(delegate: Delegate | null): Delegate | null {
  return isDelegatedToAgent(delegate) ? null : AGENT_DELEGATE;
}
