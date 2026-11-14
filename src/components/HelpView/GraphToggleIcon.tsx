interface Props {
  /** Whether the graph is expanded: arrows point inward to collapse it, outward to expand it. */
  expanded: boolean;
}

/** The expand / collapse glyph of the graph button: two corner arrows, outward or inward. */
export default function GraphToggleIcon({ expanded }: Props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded ? (
        <>
          <path d="M20 4 L14 10 M14 5 L14 10 L19 10" />
          <path d="M4 20 L10 14 M10 19 L10 14 L5 14" />
        </>
      ) : (
        <>
          <path d="M14 10 L20 4 M15 4 L20 4 L20 9" />
          <path d="M10 14 L4 20 M4 15 L4 20 L9 20" />
        </>
      )}
    </svg>
  );
}
