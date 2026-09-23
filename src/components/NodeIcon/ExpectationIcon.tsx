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

/**
 * An Expectation renders as a **downward-pointing triangle** — something on its way to you.
 *
 * Straight-edged on purpose, like the Commitment's shield: every kind a person *does* is round
 * (a Task is a circle, a Goal a ring), and a wait is not something you do. At the smallest size the
 * Mindmap draws, the outline is still the only inverted triangle in the tree.
 *
 * **Hollow while pending, solid once released** — the same "answer owed / answer given" reading the
 * Commitment glyph uses. An archived wait is **struck through**, as an expired Commitment is.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status, isArchived }: Props) {
  const top = cy - r * 0.7;
  const half = r * 0.85;
  const tip = cy + r * 0.85;
  const released = status === "released";
  const strike = r * 0.9;
  return (
    <g opacity={opacity}>
      <polygon
        points={`${(cx - half).toFixed(2)},${top.toFixed(2)} ${(cx + half).toFixed(2)},${top.toFixed(2)} ${cx.toFixed(2)},${tip.toFixed(2)}`}
        fill={released ? color : "none"}
        stroke={color}
        strokeWidth={r * 0.2}
        strokeLinejoin="round"
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
