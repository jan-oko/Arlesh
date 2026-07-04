interface Props { cx: number; cy: number; r: number; color: string; }

/** A calendar page with a header band and two binding tabs — the Plan (scheduling) window. */
export default function CalendarIcon({ cx, cy, r, color }: Props) {
  const x = cx - r * 0.8;
  const y = cy - r * 0.6;
  const w = r * 1.6;
  const h = r * 1.5;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.15} strokeLinecap="round" strokeLinejoin="round">
      <rect x={x} y={y} width={w} height={h} rx={r * 0.18} />
      <line x1={x} y1={y + h * 0.34} x2={x + w} y2={y + h * 0.34} />
      <line x1={cx - r * 0.35} y1={y - r * 0.28} x2={cx - r * 0.35} y2={y + r * 0.18} />
      <line x1={cx + r * 0.35} y1={y - r * 0.28} x2={cx + r * 0.35} y2={y + r * 0.18} />
    </g>
  );
}
