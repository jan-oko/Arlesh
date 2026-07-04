import { GOAL_STATUS } from "@/utils/status-mapping";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; status?: string | undefined }

/**
 * A goal renders as Lucide's **target** (concentric rings) while open, and once **achieved** as Lucide's
 * **goal** — a flag planted in the rings ("goal reached"). Both ISC-licensed; drawn in the shared node
 * coordinate system by translate+scaling the 24×24 box so the outer ring maps to the node radius `r`.
 */
export default function GoalIcon({ cx, cy, r, color, opacity, status }: Props) {
  const achieved = status === GOAL_STATUS.ACHIEVED;
  const scale = r / 10; // Lucide's outer ring (box radius 10) → node radius r
  return (
    <g
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)`}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    >
      {achieved ? (
        <>
          <path d="M12 13V2l8 4-8 4" />
          <path d="M20.561 10.222a9 9 0 1 1-12.55-5.29" />
          <path d="M8.002 9.997a5 5 0 1 0 8.9 2.02" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </>
      )}
    </g>
  );
}
