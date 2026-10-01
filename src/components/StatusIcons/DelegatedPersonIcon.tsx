interface Props { cx: number; cy: number; r: number; color: string; }

/** Delegated to a Person: a head over shoulders — someone else holds the work. */
export default function DelegatedPersonIcon({ cx, cy, r, color }: Props) {
  const scale = r / 11;
  const headY = cy - 4 * scale;
  const shouldersY = cy + 8 * scale;
  const halfWidth = 7 * scale;
  return (
    <g data-glyph="delegated-person" fill="none" stroke={color} strokeWidth={r * 0.18} strokeLinecap="round">
      <circle cx={cx} cy={headY} r={3.5 * scale} />
      <path d={`M ${cx - halfWidth} ${shouldersY} A ${halfWidth} ${halfWidth} 0 0 1 ${cx + halfWidth} ${shouldersY}`} />
    </g>
  );
}
