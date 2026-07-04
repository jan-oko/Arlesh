interface Props { cx: number; cy: number; r: number; color: string; opacity: number }

/**
 * The "blocked" glyph shared by tasks and goals: a disc with a rectangular slot cut out of its centre,
 * drawn in the node's own colour and only lightly washed red — so it stays within the colour scheme
 * rather than jumping to a pure-red stop sign.
 */
export default function BlockedMark({ cx, cy, r, color, opacity }: Props) {
  const rw = r * 0.53; // slot half-width
  const rh = r * 0.19; // slot half-height
  const disc = `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r} ${r} ${r} 0 1 0 0 ${-2 * r}z`;
  const slot = `M${cx - rw} ${cy - rh}H${cx + rw}V${cy + rh}H${cx - rw}Z`;
  const d = disc + slot; // even-odd: disc minus the centred slot
  return (
    <g opacity={opacity}>
      <path d={d} fill={color} fillRule="evenodd" />
      <path d={d} fill="#dc2626" fillRule="evenodd" opacity={0.3} />
    </g>
  );
}
