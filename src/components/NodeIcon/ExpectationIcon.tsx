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

/** How many dashes the lower half breaks into. Few and fat, so they still read as dashes — not as
 * a grey smudge — at the Mindmap's smallest node size. */
const DASHES = 3;

/**
 * An Expectation renders as a **half-drawn ring** — solid across the top, dashed across the bottom:
 * a circle that is not closed yet, the shape of "waiting on something".
 *
 * **Pending** is that ring. **Released** is a solid disc: the wait is over and the ring has filled.
 * A full hollow ring would have been the obvious "done" — but that is the Task glyph's To Do, and a
 * wait must not read as a Task at the sizes the Mindmap draws. An **archived** wait is the pending
 * ring struck through, as an expired Commitment is — the same family, one line more.
 *
 * Deliberately **still**: a board of waits each moving would be motion with nothing to say. It is
 * not the hourglass (an Asynchronous Task's badge) and not the clock (a Time Scope's badge) — both
 * badges, drawn in the status row, where this is the node glyph itself.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status, isArchived }: Props) {
  const radius = r * 0.72;
  const stroke = r * 0.26;
  if (status === "released" && !isArchived) {
    return <circle cx={cx} cy={cy} r={radius + stroke / 2} fill={color} opacity={opacity} />;
  }
  const left = `${(cx - radius).toFixed(2)} ${cy.toFixed(2)}`;
  const right = `${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
  const r2 = radius.toFixed(2);
  // The lower half is cut into `DASHES` dashes with a gap on either side of each, so it neither
  // touches the solid top — which would blur the two halves together — nor ends in a stub.
  const segment = (Math.PI * radius) / (2 * DASHES + 1);
  const strike = r * 0.9;
  return (
    <g opacity={opacity}>
      <path d={`M ${left} A ${r2} ${r2} 0 0 1 ${right}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <path
        data-part="dashed"
        d={`M ${right} A ${r2} ${r2} 0 0 1 ${left}`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${segment.toFixed(2)} ${segment.toFixed(2)}`}
        strokeDashoffset={segment.toFixed(2)}
      />
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
