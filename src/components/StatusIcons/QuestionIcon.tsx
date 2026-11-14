interface Props { cx: number; cy: number; r: number; color: string; }

/** A question mark: an agent has a question open for the user. (A review is the checked page, so
 * the two stay distinguishable.) */
export default function QuestionIcon({ cx, cy, r, color }: Props) {
  const p = (dx: number, dy: number) => `${cx + dx * r} ${cy + dy * r}`;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.32} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${p(-0.42, -0.4)} C ${p(-0.42, -1.05)} ${p(0.5, -1.05)} ${p(0.5, -0.4)} C ${p(0.5, 0.05)} ${p(0, 0.1)} ${p(0, 0.4)}`} />
      <circle cx={cx} cy={cy + 0.85 * r} r={r * 0.12} fill={color} />
    </g>
  );
}
