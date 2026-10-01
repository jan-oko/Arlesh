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

  // On Agent — an agent holds it: a small bot head inside the ring, antenna and two eyes.
  if (status === "on_agent") {
    const w = r * 0.86;
    const h = r * 0.58;
    const top = cy - h / 2 + r * 0.12;
    return (
      <g opacity={opacity} data-agentic-status="on_agent">
        {ring}
        <rect x={cx - w / 2} y={top} width={w} height={h} rx={r * 0.14} stroke={color} strokeWidth={sw * 0.6} fill="none" />
        <line x1={cx} y1={top} x2={cx} y2={top - r * 0.2} stroke={color} strokeWidth={sw * 0.6} strokeLinecap="round" />
        <circle cx={cx} cy={top - r * 0.26} r={r * 0.08} fill={color} />
        <circle cx={cx - w * 0.22} cy={top + h * 0.48} r={r * 0.09} fill={color} />
        <circle cx={cx + w * 0.22} cy={top + h * 0.48} r={r * 0.09} fill={color} />
      </g>
    );
  }

  // Review — the agent is waiting on you: an inbox tray inside the ring, with an arrow coming
  // down into it. Its own glyph, apart from Started's and On Agent's at a glance.
  if (status === "review") {
    const w = r * 0.96;
    const left = cx - w / 2;
    const right = cx + w / 2;
    const rim = cy + r * 0.04;
    const floor = cy + r * 0.4;
    const lip = rim + r * 0.16;
    const tray = `M ${left},${rim} L ${left},${floor} L ${right},${floor} L ${right},${rim}`
      + ` M ${left},${rim} L ${cx - w * 0.2},${rim} L ${cx - w * 0.12},${lip} L ${cx + w * 0.12},${lip}`
      + ` L ${cx + w * 0.2},${rim} L ${right},${rim}`;
    const arrow = `M ${cx},${cy - r * 0.48} L ${cx},${cy - r * 0.02} M ${cx - r * 0.18},${cy - r * 0.2}`
      + ` L ${cx},${cy - r * 0.02} L ${cx + r * 0.18},${cy - r * 0.2}`;
    return (
      <g opacity={opacity} data-agentic-status="review">
        {ring}
        <path d={tray} stroke={color} strokeWidth={sw * 0.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <path d={arrow} stroke={color} strokeWidth={sw * 0.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </g>
    );
  }

  // Doing is the Agentic model's In Progress: the user is on it, and it draws the same.
  if (status === "in_progress" || status === "doing") {
    return (
      <g opacity={opacity}>
        {ring}
        <circle cx={cx} cy={cy} r={r * 0.4} fill={color} />
      </g>
    );
  }

  return <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" strokeDasharray={dashes} data-compound={marked} opacity={opacity} />;
}
