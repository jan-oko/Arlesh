interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * A crossed-out eye: an almond outline — upper and lower lid meeting at sharp corners — with a
 * solid pupil, struck through by one diagonal from lower left to upper right. The node is marked
 * **Private** itself, so it is not shown, with its subtree, while Private Mode is off; "an eye,
 * struck out" is the common mark for exactly that.
 *
 * Settled by the user (2026-09-27) over two closed-eye drafts: a lid arc with lashes, then an
 * almond with a tinted lid.
 * An eye rather than a padlock, because a lock would say the node is locked — read-only, or not
 * writable by the MCP — which is not what the flag means.
 */
export default function PrivateIcon({ cx, cy, r, color }: Props) {
  const reach = r * 0.95;
  const lid = r * 0.9;
  const slash = r * 0.75;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.15} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx - reach} ${cy} Q ${cx} ${cy - lid} ${cx + reach} ${cy} Q ${cx} ${cy + lid} ${cx - reach} ${cy} Z`} />
      <circle cx={cx} cy={cy} r={r * 0.22} fill={color} stroke="none" />
      <path d={`M ${cx - slash} ${cy + slash} L ${cx + slash} ${cy - slash}`} />
    </g>
  );
}
