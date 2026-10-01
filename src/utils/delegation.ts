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

/** Who holds a delegated Task, as a label names them: the Agent, or a Person by name — `null` when
 * the Person's name is not known. */
export type DelegateHolder = { kind: "agent" } | { kind: "person"; name: string | null };

/** The holder `delegate` names, its Person's name read out of `personNames`. */
export function delegateHolder(delegate: Delegate, personNames: ReadonlyMap<number, string>): DelegateHolder {
  if (delegate.kind === "agent") return { kind: "agent" };
  return { kind: "person", name: personNames.get(delegate.id) ?? null };
}

/** Whether any of `delegates` is a Person — the only case a label needs People's names for. */
export function namesAPerson(delegates: readonly (Delegate | null | undefined)[]): boolean {
  return delegates.some((delegate) => delegate?.kind === "person");
}
