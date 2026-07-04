interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  /** Draw a red X over the clock — the relevance window has passed (out of scope). */
  crossedOut?: boolean;
}

/** A clock face with two hands; optionally crossed out when the scope window has passed. */
export default function ClockIcon({ cx, cy, r, color, crossedOut = false }: Props) {
  const stroke = r * 0.16;
  return (
    <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={cx} cy={cy} r={r * 0.9} />
      <path d={`M ${cx} ${cy - r * 0.5} L ${cx} ${cy} L ${cx + r * 0.4} ${cy + r * 0.28}`} />
      {crossedOut && (
        <path
          d={`M ${cx - r * 0.75} ${cy - r * 0.75} L ${cx + r * 0.75} ${cy + r * 0.75} M ${cx + r * 0.75} ${cy - r * 0.75} L ${cx - r * 0.75} ${cy + r * 0.75}`}
          stroke="var(--danger)"
          strokeWidth={r * 0.2}
        />
      )}
    </g>
  );
}
