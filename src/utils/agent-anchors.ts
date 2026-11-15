/** The DOM id of the Agents section on the Settings page. */
export const AGENTS_SECTION_ID = "settings-agents";

/** The DOM id of one agent's row, so the status menu can scroll to it. */
export function agentRowId(agentId: number): string {
  return `settings-agent-${agentId}`;
}

/** The DOM id of one account's row. */
export function accountRowId(label: string): string {
  return `settings-account-${encodeURIComponent(label)}`;
}
