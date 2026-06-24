interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

export default function ProjectIcon({ cx, cy, r, color, opacity }: Props) {
  const poleX = cx - r * 0.25;
  return (
    <g opacity={opacity}>
      <line x1={poleX} y1={cy - r} x2={poleX} y2={cy + r} stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" />
      <polygon points={`${poleX},${cy - r} ${cx + r},${cy - r * 0.15} ${poleX},${cy + r * 0.35}`} fill={color} />
    </g>
  );
}
