interface Props { cx: number; cy: number; r: number; color: string; }

/** A six-point snowflake — a Frozen goal/project. */
export default function IceIcon({ cx, cy, r, color }: Props) {
  const spokes = [0, 60, 120]
    .map((deg) => {
      const angle = (deg * Math.PI) / 180;
      const dx = Math.cos(angle) * r * 0.9;
      const dy = Math.sin(angle) * r * 0.9;
      return `M ${cx - dx} ${cy - dy} L ${cx + dx} ${cy + dy}`;
    })
    .join(" ");
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.16} strokeLinecap="round">
      <path d={spokes} />
    </g>
  );
}
