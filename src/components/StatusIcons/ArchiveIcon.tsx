interface Props { cx: number; cy: number; r: number; color: string; }

/** A storage box with a lid — an Archived item, or a scoped item that has lapsed. */
export default function ArchiveIcon({ cx, cy, r, color }: Props) {
  const x = cx - r * 0.85;
  const w = r * 1.7;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.15} strokeLinecap="round" strokeLinejoin="round">
      <rect x={x} y={cy - r * 0.7} width={w} height={r * 0.55} rx={r * 0.1} />
      <rect x={x + r * 0.12} y={cy - r * 0.1} width={w - r * 0.24} height={r * 0.9} />
      <line x1={cx - r * 0.3} y1={cy + r * 0.2} x2={cx + r * 0.3} y2={cy + r * 0.2} />
    </g>
  );
}
