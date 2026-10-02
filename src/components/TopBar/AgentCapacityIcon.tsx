/**
 * The agent capacity lock's glyph in the agents' status row: a padlock — new work is locked out.
 * Drawn in `currentColor`; its own file so the glyph can change without touching the row.
 */
export default function AgentCapacityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-glyph="capacity">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="5" y="10.5" width="14" height="10" rx="2" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </g>
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
