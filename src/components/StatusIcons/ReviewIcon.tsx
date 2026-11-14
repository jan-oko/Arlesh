interface Props { cx: number; cy: number; r: number; color: string; }

/** A checked page: an agent has handed work back for the user's review. */
export default function ReviewIcon({ cx, cy, r, color }: Props) {
  const half = r * 0.72;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={cx - half} y={cy - r * 0.95} width={half * 2} height={r * 1.9} rx={r * 0.2} />
      <path d={`M ${cx - r * 0.35} ${cy + r * 0.05} L ${cx - r * 0.05} ${cy + r * 0.4} L ${cx + r * 0.42} ${cy - r * 0.3}`} />
    </g>
  );
}
