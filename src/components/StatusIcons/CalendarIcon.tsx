interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  /** Strike the page through — a Plan deliberately taken away (a Habit occurrence left unplanned). */
  crossedOut?: boolean;
}

/** A calendar page with a header band and two binding tabs — the Plan (scheduling) window. */
export default function CalendarIcon({ cx, cy, r, color, crossedOut = false }: Props) {
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
      {crossedOut && <line x1={cx - r * 0.85} y1={cy + r * 0.85} x2={cx + r * 0.85} y2={cy - r * 0.85} />}
    </g>
  );
}
