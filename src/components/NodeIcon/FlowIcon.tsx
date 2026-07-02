interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A flow is a stream of instances — a wave reads as "flow".
export default function FlowIcon({ cx, cy, r, color, opacity }: Props) {
  const half = r * 0.7; // horizontal reach of each half-wave
  const amp = r * 0.3; // vertical swing
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <path
        d={`M ${cx - half} ${cy} q ${half / 2} ${-amp}, ${half} 0 t ${half} 0`}
        fill="none"
        stroke="var(--canvas-bg)"
        strokeWidth={r * 0.16}
        strokeLinecap="round"
      />
    </g>
  );
}
