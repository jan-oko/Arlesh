import type { NodeKind } from "@/utils/tree-layout";

interface Props {
  kind: NodeKind;
  status: string | undefined;
  isBlocked: boolean;
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

export default function NodeIcon({ kind, status, isBlocked, cx, cy, r, color, opacity }: Props) {
  if (kind === "aspect") return null;

  if (kind === "domain") {
    return (
      <polygon
        points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
        fill={color}
        opacity={opacity}
      />
    );
  }

  if (kind === "project") {
    const poleX = cx - r * 0.25;
    return (
      <g opacity={opacity}>
        <line
          x1={poleX} y1={cy - r} x2={poleX} y2={cy + r}
          stroke={color} strokeWidth={r * 0.2} strokeLinecap="round"
        />
        <polygon
          points={`${poleX},${cy - r} ${cx + r},${cy - r * 0.15} ${poleX},${cy + r * 0.35}`}
          fill={color}
        />
      </g>
    );
  }

  if (kind === "goal") {
    const sw = r * 0.18;
    return (
      <g opacity={opacity}>
        <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={sw} fill="none" />
        <circle cx={cx} cy={cy} r={r * 0.55} stroke={color} strokeWidth={sw} fill="none" />
        <circle cx={cx} cy={cy} r={r * 0.2} fill={color} />
      </g>
    );
  }

  if (kind === "tag") {
    const holeR = r * 0.18;
    return (
      <g opacity={opacity}>
        <polygon
          points={`
            ${cx - r * 0.75},${cy - r * 0.72}
            ${cx + r * 0.3},${cy - r * 0.72}
            ${cx + r},${cy}
            ${cx + r * 0.3},${cy + r * 0.72}
            ${cx - r * 0.75},${cy + r * 0.72}
          `}
          fill={color}
        />
        <circle cx={cx - r * 0.42} cy={cy} r={holeR} fill="var(--canvas-bg)" />
      </g>
    );
  }

  // task
  if (isBlocked) {
    const f = 0.42;
    return (
      <polygon
        points={`
          ${cx + r * f},${cy - r}
          ${cx + r},${cy - r * f}
          ${cx + r},${cy + r * f}
          ${cx + r * f},${cy + r}
          ${cx - r * f},${cy + r}
          ${cx - r},${cy + r * f}
          ${cx - r},${cy - r * f}
          ${cx - r * f},${cy - r}
        `}
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
        <path
          d={`M ${cx - r * 0.4},${cy} L ${cx - r * 0.05},${cy + r * 0.38} L ${cx + r * 0.5},${cy - r * 0.32}`}
          stroke={color} strokeWidth={sw} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />
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

  // todo (default)
  return (
    <circle cx={cx} cy={cy} r={cr} stroke={color} strokeWidth={sw} fill="none" opacity={opacity} />
  );
}
