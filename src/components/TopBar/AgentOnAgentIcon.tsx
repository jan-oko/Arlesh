/**
 * Agentic Tasks On Agent: the app's On Agent glyph — a ring around a small bot head, as `TaskIcon`
 * draws it on the canvas — in `currentColor`.
 */
export default function AgentOnAgentIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" data-glyph="on-agent">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5.1" y="6.9" width="5.8" height="3.9" rx="0.9" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <line x1="8" y1="6.9" x2="8" y2="5.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="8" cy="5.2" r="0.6" fill="currentColor" />
      <circle cx="6.6" cy="8.8" r="0.65" fill="currentColor" />
      <circle cx="9.4" cy="8.8" r="0.65" fill="currentColor" />
    </svg>
  );
}
