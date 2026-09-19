interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * A tray: three stacked lines under a lid — work put down in a pile to come back to.
 *
 * Deliberately unlike the Frozen snowflake and the Archived box: Backlog is a Task-only state that
 * neither of those means, and the canvas should say which one a node is in without a tooltip.
 */
export default function BacklogIcon({ cx, cy, r, color }: Props) {
  const half = r * 0.8;
  const step = r * 0.55;
  const lines = [-step, 0, step].map((dy, i) => (
    <path key={i} d={`M ${cx - half} ${cy + dy} L ${cx + half * (i === 0 ? 1 : i === 1 ? 0.6 : 0.25)} ${cy + dy}`} />
  ));
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round">
      {lines}
    </g>
  );
}
