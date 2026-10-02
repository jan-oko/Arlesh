/**
 * The derived reason a Task carries for each unmet dependency: "Blocked by task 6f3 (Write spec)".
 * The target is named by its **short id** — the one the MCP shows an agent — falling back to its row
 * id while it has none. The one place the app spells it, so the board, the cards and the editors
 * cannot drift apart.
 */
export function blockedByText(kind: string, shortId: string | undefined, id: string | number, title: string): string {
  return `Blocked by ${kind} ${shortId ?? String(id)} (${title})`;
}
