import { GOAL_STATUS } from "@/utils/status-mapping";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; status?: string | undefined; isBlocked?: boolean }

// MDL2 "Bullseye" (Micon, MIT). The glyph's two concentric rings are notched at the top-right where
// an arrow enters; we reuse those exact rings for both states so they stay pixel-identical. Open goal:
// rings + a centre dot. Achieved goal: the full glyph — the arrow drops into the notch ("goal hit").
const RINGS =
  "M1024 640q-80 0-149.5 30t-122 82.5T670 875t-30 149q0 80 30 149.5t82.5 122 122 82.5 149.5 30q79 0 149-30t122.5-82.5 82.5-122 30-149.5q0-64-22-128h134q8 32 12 64t4 64q0 106-40.5 199t-110 162.5-162.5 110-199 40.5-199-40.5-162.5-110T553 1223t-40-199 40-199 109.5-162.5 162.5-110 199-40.5q32 0 64 4t64 12v134q-64-22-128-22zm866 155q30 113 30 229 0 123-32 237.5t-90.5 214T1657 1657t-181.5 140.5-214 90.5-237.5 32-237.5-32-214-90.5T391 1657t-140.5-181.5T160 1262t-32-238q0-123 32-237.5t90.5-214T391 391t181.5-140.5T786 160t238-32q116 0 229 30l-101 101v8q-32-5-64-8t-64-3q-106 0-204 27.5T636.5 361 481 481 361 636.5 283.5 820 256 1024t27.5 204 77.5 183.5T481 1567t155.5 120 183.5 77.5 204 27.5 204-27.5 183.5-77.5 155.5-120 120-155.5 77.5-183.5 27.5-204q0-32-3-64t-8-64h8z";
// The arrow (shaft, head and fletching) that drops into the ring notch when a goal is achieved. Drawn
// as its own path (absolute start) so it can carry a darker shade than the rings.
const ARROW =
  "M1280 677V390L1664 6V384h378l-384 384h-287l-223 223q4 15 4 33 0 27-10 50t-27.5 40.5-40.5 27.5-50 10-50-10-40.5-27.5T906 1074t-10-50 10-50 27.5-40.5T974 906t50-10q18 0 33 4zm128-37h197l128-128h-197V315l-128 128v197z";
/** Opacity of the white overlay that brightens the arrow so it reads distinctly against the rings. */
const ARROW_SHADE = 0.5;
/**
 * Full concentric target for the open state — complete circles (no arrow notch), aligned to the MDL2
 * ring radii so it sits with the achieved glyph. Five nested circles + even-odd fill = two rings and a
 * centre dot.
 */
const FULL_TARGET =
  "M1024 128a896 896 0 1 0 0 1792 896 896 0 1 0 0-1792zM1024 256a768 768 0 1 0 0 1536 768 768 0 1 0 0-1536zM1024 512a512 512 0 1 0 0 1024 512 512 0 1 0 0-1024zM1024 640a384 384 0 1 0 0 768 384 384 0 1 0 0-768zM1024 896a128 128 0 1 0 0 256 128 128 0 1 0 0-256z";

/**
 * A goal renders as a target: a plain **full-circle** target while open, and the MDL2 **Bullseye** —
 * a target struck by an arrow — once **achieved**. Drawn in the shared node coordinate system by
 * translate+scaling the 2048 box so it fills the node's icon diameter (the arrow reaches the corner).
 */
export default function GoalIcon({ cx, cy, r, color, opacity, status, isBlocked = false }: Props) {
  if (isBlocked) {
    // Same red stop-sign as a blocked task, so a blocked goal reads the same at a glance.
    const f = 0.42;
    return (
      <polygon
        points={`${cx + r * f},${cy - r} ${cx + r},${cy - r * f} ${cx + r},${cy + r * f} ${cx + r * f},${cy + r} ${cx - r * f},${cy + r} ${cx - r},${cy + r * f} ${cx - r},${cy - r * f} ${cx - r * f},${cy - r}`}
        fill="#dc2626"
        opacity={opacity}
      />
    );
  }
  const achieved = status === GOAL_STATUS.ACHIEVED;
  const scale = r / 1024; // the 2048 box maps to the node's icon diameter (2r)
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(-1024 -1024)`} fill={color} opacity={opacity}>
      {achieved ? (
        <>
          <path d={RINGS} />
          <path d={ARROW} />
          {/* Brighten just the arrow (a white wash) so it stands out from the rings. */}
          <path d={ARROW} fill="#fff" opacity={ARROW_SHADE} />
        </>
      ) : (
        <path d={FULL_TARGET} fillRule="evenodd" />
      )}
    </g>
  );
}
