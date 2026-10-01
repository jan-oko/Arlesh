/**
 * The agent capacity lock's glyph in the top bar, drawn in `currentColor` at the top bar's icon size.
 * Its own file so it can be swapped without touching the button around it; for now a gauge with its
 * needle near the top of the range.
 */
export default function AgentCapacityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="M12 14l5-5" />
    </svg>
  );
}
