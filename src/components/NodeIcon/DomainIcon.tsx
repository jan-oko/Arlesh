interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

export default function DomainIcon({ cx, cy, r, color, opacity }: Props) {
  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill={color}
      opacity={opacity}
    />
  );
}
