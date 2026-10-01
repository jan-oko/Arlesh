import BlockedMark from "./BlockedMark";

/** How many dashes the outer ring of a compound Task's glyph is cut into. */
const COMPOUND_RING_DASHES = 8;

interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  status: string | undefined;
  isBlocked: boolean;
  /** The Task **consists of its sub-items**: `status` is derived, and the outer ring is drawn
   * dashed to say so. Nothing else about the glyph changes. */
  compound?: boolean | undefined;
}

export default function TaskIcon({ cx, cy, r, color, opacity, status, isBlocked, compound = false }: Props) {
  if (isBlocked) return <BlockedMark cx={cx} cy={cy} r={r} color={color} opacity={opacity} />;

  const cr = r * 0.85;
  const sw = r * 0.22;
  // Equal dashes and gaps, a whole number of each round the ring, so it closes evenly.
  const dash = (2 * Math.PI * cr) / (COMPOUND_RING_DASHES * 2);
  const dashes = compound ? `${dash} ${dash}` : undefined;
  const marked = compound ? "true" : undefined;
  const ring = (
    <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" strokeDasharray={dashes} data-compound={marked} />
  );

  if (status === "done") {
    return (
      <g opacity={opacity}>
        {ring}
        <path d={`M ${cx - r * 0.4},${cy} L ${cx - r * 0.05},${cy + r * 0.38} L ${cx + r * 0.5},${cy - r * 0.32}`} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }

  // Started — begun and paused — is In Progress's glyph with the inner circle left unfilled.
  if (status === "started") {
    return (
      <g opacity={opacity}>
        {ring}
        <circle cx={cx} cy={cy} r={r * 0.4} stroke={color} strokeWidth={sw * 0.7} fill="none" />
      </g>
    );
  }

  if (status === "in_progress") {
    return (
      <g opacity={opacity}>
        {ring}
        <circle cx={cx} cy={cy} r={r * 0.4} fill={color} />
      </g>
    );
  }

  return <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" strokeDasharray={dashes} data-compound={marked} opacity={opacity} />;
}
