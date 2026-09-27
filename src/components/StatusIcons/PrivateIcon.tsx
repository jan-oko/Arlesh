interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * A closed eye: a lowered lid — one arc sagging below the centre — with three short lashes hanging
 * from it. The node is marked **Private** itself, so it is hidden, with its subtree, while Private
 * Mode is off.
 *
 * An eye shut rather than a padlock. A lock would say the node is locked — read-only, or not
 * writable by the MCP — which is not what the flag means; the flag means *not shown*. A lock's body
 * is also one more small rounded box in a row that already has the archive box and the calendar,
 * where an open arc with lashes has no neighbour it could be mistaken for. The lashes are what keep
 * it from reading as a smile.
 */
export default function PrivateIcon({ cx, cy, r, color }: Props) {
  // Lid and lashes together run from 0.45r above `cy` to 0.45r below it, so the eye sits centred.
  const lidY = cy - r * 0.45;
  const reach = r * 0.85;
  // The lid is a quadratic curve; the lashes hang from it at t = 0.2, 0.5 and 0.8.
  const sideX = r * 0.51;
  const sideY = cy - r * 0.19;
  const midY = cy - r * 0.05;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.15} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx - reach} ${lidY} Q ${cx} ${cy + r * 0.35} ${cx + reach} ${lidY}`} />
      <path d={`M ${cx} ${midY} L ${cx} ${midY + r * 0.5}`} />
      <path d={`M ${cx - sideX} ${sideY} L ${cx - r * 0.78} ${sideY + r * 0.42}`} />
      <path d={`M ${cx + sideX} ${sideY} L ${cx + r * 0.78} ${sideY + r * 0.42}`} />
    </g>
  );
}
