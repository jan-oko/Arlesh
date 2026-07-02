interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A flow is a startable template — a play triangle reads as "spin up instances".
export default function FlowIcon({ cx, cy, r, color, opacity }: Props) {
  const t = r * 0.45;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <path
        d={`M ${cx - t * 0.5} ${cy - t} L ${cx + t * 0.85} ${cy} L ${cx - t * 0.5} ${cy + t} Z`}
        fill="var(--canvas-bg)"
      />
    </g>
  );
}
