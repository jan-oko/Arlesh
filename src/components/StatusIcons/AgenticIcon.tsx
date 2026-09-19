interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * A small bot head — an antenna over a rounded face with two eyes: work that suits being handed to
 * an agent.
 *
 * Deliberately unlike every other badge in the row, which all say something about *where the work
 * stands*; this one says something about *who could do it*, and reads at a glance as the only
 * non-human mark on the canvas.
 */
export default function AgenticIcon({ cx, cy, r, color }: Props) {
  const halfWidth = r * 0.78;
  const headTop = cy - r * 0.45;
  const headBottom = cy + r * 0.75;
  const eyeY = cy + r * 0.15;
  const eyeR = r * 0.14;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round">
      <path d={`M ${cx} ${cy - r} L ${cx} ${headTop}`} />
      <rect
        x={cx - halfWidth}
        y={headTop}
        width={halfWidth * 2}
        height={headBottom - headTop}
        rx={r * 0.28}
      />
      <circle cx={cx - r * 0.33} cy={eyeY} r={eyeR} fill={color} stroke="none" />
      <circle cx={cx + r * 0.33} cy={eyeY} r={eyeR} fill={color} stroke="none" />
    </g>
  );
}
