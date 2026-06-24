interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

export default function GoalIcon({ cx, cy, r, color, opacity }: Props) {
  const sw = r * 0.18;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={sw} fill="none" />
      <circle cx={cx} cy={cy} r={r * 0.55} stroke={color} strokeWidth={sw} fill="none" />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={color} />
    </g>
  );
}
