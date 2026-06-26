interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

export default function InfoIcon({ cx, cy, r, color, opacity }: Props) {
  const dotR = r * 0.12;
  const stemW = r * 0.22;
  const stemH = r * 0.52;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle cx={cx} cy={cy - r * 0.32} r={dotR} fill="var(--canvas-bg)" />
      <rect
        x={cx - stemW / 2}
        y={cy - r * 0.05}
        width={stemW}
        height={stemH}
        rx={stemW / 2}
        fill="var(--canvas-bg)"
      />
    </g>
  );
}
