interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * An hourglass — a Task whose doing starts a **wait** rather than finishing something.
 *
 * Deliberately not a second clock face. The clock in this row means a Time Scope: a window this
 * item is relevant in, which passes whether or not anybody acts. An hourglass is a wait somebody
 * *started*, which is exactly the difference the flag records, and the two shapes are far enough
 * apart to tell at badge size — a circle with hands against two triangles in a frame.
 */
export default function AsyncIcon({ cx, cy, r, color }: Props) {
  const halfWidth = r * 0.62;
  const top = cy - r * 0.82;
  const bottom = cy + r * 0.82;
  const stroke = r * 0.2;
  return (
    <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx - halfWidth} ${top} H ${cx + halfWidth}`} />
      <path d={`M ${cx - halfWidth} ${bottom} H ${cx + halfWidth}`} />
      <path
        d={`M ${cx - halfWidth} ${top} L ${cx + halfWidth} ${bottom} M ${cx + halfWidth} ${top} L ${cx - halfWidth} ${bottom}`}
      />
    </g>
  );
}
