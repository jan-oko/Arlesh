interface Props { cx: number; cy: number; r: number; color: string; }

/** An exclamation mark — a kept-past-window (overdue) item; rendered in a warning colour. */
export default function ExclamationIcon({ cx, cy, r, color }: Props) {
  return (
    <g fill={color}>
      <rect x={cx - r * 0.13} y={cy - r * 0.75} width={r * 0.26} height={r * 0.95} rx={r * 0.13} />
      <circle cx={cx} cy={cy + r * 0.62} r={r * 0.17} />
    </g>
  );
}
