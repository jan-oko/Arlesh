interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A habit recurs — two arrows chasing clockwise round a circle read as "repeat".
export default function HabitIcon({ cx, cy, r, color, opacity }: Props) {
  const ar = r * 0.62; // circle radius
  const head = r * 0.34; // arrowhead reach
  return (
    <g opacity={opacity} fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round">
      {/* Top half, left → right over the top (clockwise). */}
      <path d={`M ${cx - ar} ${cy} A ${ar} ${ar} 0 0 1 ${cx + ar} ${cy}`} />
      {/* Arrowhead at the right end, pointing down (the clockwise tangent). */}
      <path d={`M ${cx + ar - head * 0.7} ${cy - head * 0.7} L ${cx + ar} ${cy} L ${cx + ar + head * 0.7} ${cy - head * 0.7}`} />
      {/* Bottom half, right → left under the bottom (clockwise). */}
      <path d={`M ${cx + ar} ${cy} A ${ar} ${ar} 0 0 1 ${cx - ar} ${cy}`} />
      {/* Arrowhead at the left end, pointing up. */}
      <path d={`M ${cx - ar - head * 0.7} ${cy + head * 0.7} L ${cx - ar} ${cy} L ${cx - ar + head * 0.7} ${cy + head * 0.7}`} />
    </g>
  );
}
