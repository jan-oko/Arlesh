interface Props { cx: number; cy: number; r: number; color: string; }

/** A point on the quadratic curve from `start` through control `control` to `end`, at `t`. */
function onCurve(t: number, start: number, control: number, end: number): number {
  return (1 - t) ** 2 * start + 2 * t * (1 - t) * control + t ** 2 * end;
}

/** Where along the closing lid the three lashes hang. */
const LASH_POSITIONS = [0.22, 0.5, 0.78];

/**
 * A closed eye: an almond — an arched upper lid and a shallower lower one meeting at two sharp
 * corners — with the lid shut over it, drawn as a faint tint of the glyph colour filling the
 * almond, and three short lashes fanning down from the closing line. The node is marked
 * **Private** itself, so it is hidden, with its subtree, while Private Mode is off.
 *
 * The almond is what makes it an eye at badge size: a single lid arc with lashes (its first draft)
 * read as a brow or a smile. The tint in place of a pupil is what makes it shut.
 *
 * An eye shut rather than a padlock. A lock would say the node is locked — read-only, or not
 * writable by the MCP — which is not what the flag means; the flag means *not shown*. A lock's body
 * is also one more small rounded box in a row that already has the archive box and the calendar.
 */
export default function PrivateIcon({ cx, cy, r, color }: Props) {
  const reach = r * 0.95;
  const cornerY = cy - r * 0.2;
  const upperLid = cy - r;
  const lowerLid = cy + r * 0.45;
  const lashLength = r * 0.4;
  const lashes = LASH_POSITIONS.map((t) => {
    const x = onCurve(t, cx - reach, cx, cx + reach);
    const y = onCurve(t, cornerY, lowerLid, cornerY);
    return `M ${x} ${y} L ${x + (x - cx) * 0.54} ${y + lashLength}`;
  });
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.15} strokeLinecap="round" strokeLinejoin="round">
      <path
        d={`M ${cx - reach} ${cornerY} Q ${cx} ${upperLid} ${cx + reach} ${cornerY} Q ${cx} ${lowerLid} ${cx - reach} ${cornerY} Z`}
        fill={color}
        fillOpacity={0.45}
      />
      <path d={lashes.join(" ")} />
    </g>
  );
}
