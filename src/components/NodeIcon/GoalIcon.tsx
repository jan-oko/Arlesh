import { GOAL_STATUS } from "@/utils/status-mapping";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; status?: string | undefined }

/**
 * A goal renders as a **target** (hollow concentric rings with a centre dot) while open, and once
 * **achieved** the centre dot is replaced by an **arrow struck into the bullseye** (from the top-right).
 */
export default function GoalIcon({ cx, cy, r, color, opacity, status }: Props) {
  const sw = r * 0.18;
  const achieved = status === GOAL_STATUS.ACHIEVED;
  const s = Math.SQRT1_2;
  const d = r * 0.9; // arrow shaft reach from the centre
  const tailX = cx + d, tailY = cy - d;
  const barb = r * 0.4; // arrowhead barb length
  const f = r * 0.29; // fletching half-length
  const g = r * 0.25; // gap between the two fletching crossbars
  const p2x = tailX - g * s, p2y = tailY + g * s;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={sw} fill="none" />
      <circle cx={cx} cy={cy} r={r * 0.55} stroke={color} strokeWidth={sw} fill="none" />
      {achieved ? (
        <g stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1={tailX} y1={tailY} x2={cx} y2={cy} />
          <path d={`M ${cx + barb} ${cy} L ${cx} ${cy} L ${cx} ${cy - barb}`} />
          <line x1={tailX + f * s} y1={tailY + f * s} x2={tailX - f * s} y2={tailY - f * s} />
          <line x1={p2x + f * s} y1={p2y + f * s} x2={p2x - f * s} y2={p2y - f * s} />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={r * 0.2} fill={color} />
      )}
    </g>
  );
}
