interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  /** `pending` or `released`. */
  status: string | undefined;
  /** The Expectation's stored archive. */
  isArchived: boolean;
}

/** How much of the ring a pending wait draws: three quarters, the gap at the top right. */
const ARC_SWEEP = 0.75;
/** Where the arc starts, measured clockwise from twelve o'clock, as a fraction of a turn. */
const ARC_START = 0.1;

/** A point on a circle of radius `radius` round `(cx, cy)`, `turn` of the way clockwise from 12. */
function pointAt(cx: number, cy: number, radius: number, turn: number): string {
  const angle = turn * 2 * Math.PI;
  return `${(cx + radius * Math.sin(angle)).toFixed(2)} ${(cy - radius * Math.cos(angle)).toFixed(2)}`;
}

/**
 * An Expectation renders as a **loading ring** — the shape a screen uses for "waiting on something".
 *
 * **Pending** is the ring with a quarter missing, as a spinner is drawn. **Released** is a solid
 * disc: the wait is over and the ring has filled. A full hollow ring, or a ring with a tick, would
 * have been the obvious "done" — but those are the Task glyph's To Do and Done, and a wait must not
 * read as a Task at the sizes the Mindmap draws. An **archived** wait is the pending ring struck
 * through, as an expired Commitment is.
 *
 * Deliberately **still**. A board of waits each turning would be motion with nothing to say, and
 * the open quarter already reads as "not finished" without it. It is not the hourglass (an
 * Asynchronous Task's badge: a wait somebody started) and not the clock (a Time Scope's badge: a
 * window passing) — both badges, both drawn in the status row, where this is the node glyph itself.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status, isArchived }: Props) {
  const radius = r * 0.72;
  const stroke = r * 0.26;
  if (status === "released" && !isArchived) {
    return <circle cx={cx} cy={cy} r={radius + stroke / 2} fill={color} opacity={opacity} />;
  }
  const arc = `M ${pointAt(cx, cy, radius, ARC_START)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 1 ${pointAt(cx, cy, radius, ARC_START + ARC_SWEEP)}`;
  const strike = r * 0.9;
  return (
    <g opacity={opacity}>
      <path d={arc} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      {isArchived && (
        <path
          d={`M ${cx - strike} ${cy + strike * 0.75} L ${cx + strike} ${cy - strike * 0.75}`}
          stroke={color}
          strokeWidth={r * 0.22}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
