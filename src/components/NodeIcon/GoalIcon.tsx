import { GOAL_STATUS } from "@/utils/status-mapping";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; status?: string | undefined }

/**
 * A goal renders as a **target** (hollow concentric rings) while open, and a filled **bullseye** once
 * **achieved** — the centre is "hit", so the rings fill in.
 */
export default function GoalIcon({ cx, cy, r, color, opacity, status }: Props) {
  const sw = r * 0.18;
  const achieved = status === GOAL_STATUS.ACHIEVED;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={sw} fill={achieved ? color : "none"} fillOpacity={achieved ? 0.3 : undefined} />
      <circle cx={cx} cy={cy} r={r * 0.55} stroke={color} strokeWidth={sw} fill={achieved ? color : "none"} fillOpacity={achieved ? 0.65 : undefined} />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={color} />
    </g>
  );
}
