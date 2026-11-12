interface Props { cx: number; cy: number; r: number; color: string; }

/** An exclamation mark: an agent has a question open for the user. */
export default function QuestionIcon({ cx, cy, r, color }: Props) {
  return (
    <g fill={color} stroke={color} strokeLinecap="round">
      <line x1={cx} y1={cy - r * 0.85} x2={cx} y2={cy + r * 0.25} strokeWidth={r * 0.36} />
      <circle cx={cx} cy={cy + r * 0.78} r={r * 0.22} stroke="none" />
    </g>
  );
}
