interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  status: string | undefined;
  isBlocked: boolean;
}

export default function TaskIcon({ cx, cy, r, color, opacity, status, isBlocked }: Props) {
  if (isBlocked) {
    const f = 0.42;
    return (
      <polygon
        points={`${cx + r * f},${cy - r} ${cx + r},${cy - r * f} ${cx + r},${cy + r * f} ${cx + r * f},${cy + r} ${cx - r * f},${cy + r} ${cx - r},${cy + r * f} ${cx - r},${cy - r * f} ${cx - r * f},${cy - r}`}
        fill="#dc2626"
        opacity={opacity}
      />
    );
  }

  const cr = r * 0.85;
  const sw = r * 0.22;

  if (status === "done") {
    return (
      <g opacity={opacity}>
        <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" />
        <path d={`M ${cx - r * 0.4},${cy} L ${cx - r * 0.05},${cy + r * 0.38} L ${cx + r * 0.5},${cy - r * 0.32}`} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }

  if (status === "in_progress") {
    return (
      <g opacity={opacity}>
        <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" />
        <circle cx={cx} cy={cy} r={r * 0.4} fill={color} />
      </g>
    );
  }

  return <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" opacity={opacity} />;
}
