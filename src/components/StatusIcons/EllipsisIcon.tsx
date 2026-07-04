interface Props { cx: number; cy: number; r: number; color: string; }

/** A horizontal ellipsis — an Info node that carries a longer Details description. */
export default function EllipsisIcon({ cx, cy, r, color }: Props) {
  const dot = r * 0.17;
  return (
    <g fill={color}>
      <circle cx={cx - r * 0.55} cy={cy} r={dot} />
      <circle cx={cx} cy={cy} r={dot} />
      <circle cx={cx + r * 0.55} cy={cy} r={dot} />
    </g>
  );
}
