interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

/**
 * An Aspect: a hexagon ring around a dot, one side for each of the six Aspects the board is made
 * of. Drawn outlined, so at glyph size it cannot be mistaken for the Domain's solid diamond.
 *
 * Only surfaces that give every node a glyph slot draw it. On the Mindmap an Aspect *is* a
 * coloured block with its name on it, and `NodeIcon` still draws nothing there.
 */
export default function AspectIcon({ cx, cy, r, color, opacity }: Props) {
  const ring = r * 0.85;
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + ring * Math.cos(angle)},${cy + ring * Math.sin(angle)}`;
  }).join(" ");
  return (
    <g opacity={opacity}>
      <polygon points={points} fill="none" stroke={color} strokeWidth={r * 0.22} strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r={r * 0.28} fill={color} />
    </g>
  );
}
