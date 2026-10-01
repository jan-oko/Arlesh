interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

/** A clock face with two hands — the Time Scope badge. Never crossed out: a passed window is said by
 * the amber Overdue border, or by the archive box on a Missed or Completed item. */
export default function ClockIcon({ cx, cy, r, color }: Props) {
  const stroke = r * 0.16;
  return (
    <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={cx} cy={cy} r={r * 0.9} />
      <path d={`M ${cx} ${cy - r * 0.5} L ${cx} ${cy} L ${cx + r * 0.4} ${cy + r * 0.28}`} />
    </g>
  );
}
