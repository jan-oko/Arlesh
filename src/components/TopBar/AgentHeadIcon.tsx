/** The agents' head in the top bar: a small bot, drawn in `currentColor`. */
export default function AgentHeadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-glyph="head">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 8V5" />
        <path d="M2 13v3M22 13v3" />
      </g>
      <circle cx="12" cy="4" r="1.4" fill="currentColor" />
      <circle cx="9" cy="14" r="1.3" fill="currentColor" />
      <circle cx="15" cy="14" r="1.3" fill="currentColor" />
    </svg>
  );
}
