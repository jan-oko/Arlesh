/**
 * Agentic Tasks In Progress: the app's In Progress glyph — a ring with its centre filled, as
 * `TaskIcon` draws it on the canvas — in `currentColor`.
 */
export default function AgentInProgressIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" data-glyph="in-progress">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="8" r="2.8" fill="currentColor" />
    </svg>
  );
}
