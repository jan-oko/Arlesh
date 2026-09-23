interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  /** `pending` or `released`. */
  status: string | undefined;
}

/** How many dashes the left half breaks into. Few and heavy, so they still read as dashes — not as
 * a grey smudge — at the Mindmap's smallest node size. */
const DASHES = 3;

/**
 * An Expectation renders as a **half-drawn ring** — solid down its right half, dashed down its
 * left: a circle not closed yet, the shape of "waiting on something".
 *
 * The glyph shows **status only**. **Pending** is the ring; **Released** is the same ring with a
 * check inside — one family, and never a Task's glyph: a Task's To Do and Done rings are whole, and
 * this one never is. **Archive is not drawn here**: an archived wait is dimmed and badged exactly as
 * every other kind is, so a pending archived wait is a dimmed ring and a released one a dimmed ring
 * with a check.
 *
 * **Monochrome** in the node's glyph colour. The reference fades its dashes one by one; at the
 * sizes the Mindmap draws, per-dash opacity reads as a smudge rather than a gradient, so every
 * dash is drawn at full strength. Deliberately **still**: a board of waits each moving would be
 * motion with nothing to say. It is not the hourglass (an Asynchronous Task's badge) and not the
 * clock (a Time Scope's badge) — both badges, drawn in the status row, where this is the node glyph.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status }: Props) {
  const radius = r * 0.72;
  const stroke = r * 0.26;
  const top = `${cx.toFixed(2)} ${(cy - radius).toFixed(2)}`;
  const bottom = `${cx.toFixed(2)} ${(cy + radius).toFixed(2)}`;
  const r2 = radius.toFixed(2);
  // The left half is cut into `DASHES` dashes with a gap on either side of each, so it neither
  // touches the solid half — which would blur the two together — nor ends in a stub.
  const segment = (Math.PI * radius) / (2 * DASHES + 1);
  return (
    <g opacity={opacity}>
      <path data-part="solid" d={`M ${top} A ${r2} ${r2} 0 0 1 ${bottom}`} fill="none" stroke={color} strokeWidth={stroke} />
      <path
        data-part="dashed"
        d={`M ${bottom} A ${r2} ${r2} 0 0 1 ${top}`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${segment.toFixed(2)} ${segment.toFixed(2)}`}
        strokeDashoffset={segment.toFixed(2)}
      />
      {status === "released" && (
        <path
          data-part="check"
          d={`M ${cx - r * 0.34},${cy} L ${cx - r * 0.06},${cy + r * 0.28} L ${cx + r * 0.36},${cy - r * 0.24}`}
          stroke={color}
          strokeWidth={r * 0.2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}
