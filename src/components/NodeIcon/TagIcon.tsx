interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

export default function TagIcon({ cx, cy, r, color, opacity }: Props) {
  const holeR = r * 0.18;
  return (
    <g opacity={opacity}>
      <polygon
        points={`${cx - r * 0.75},${cy - r * 0.72} ${cx + r * 0.3},${cy - r * 0.72} ${cx + r},${cy} ${cx + r * 0.3},${cy + r * 0.72} ${cx - r * 0.75},${cy + r * 0.72}`}
        fill={color}
      />
      <circle cx={cx - r * 0.42} cy={cy} r={holeR} fill="var(--canvas-bg)" />
    </g>
  );
}
