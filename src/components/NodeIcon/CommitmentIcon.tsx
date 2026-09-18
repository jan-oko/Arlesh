import type { Verdict } from "@/api/commitments";
import { VERDICT } from "@/api/commitments";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; verdict?: Verdict | undefined }

/** Opacity of the white wash that lifts the verdict mark clear of the shield behind it. */
const MARK_SHADE = 0.55;

/** Half-width of the shield, as a fraction of the icon radius. */
const HALF_WIDTH = 0.74;
/** The shield's flat top edge, relative to the icon centre. */
const TOP = -0.86;
/** Where the straight sides stop and the point begins. */
const SHOULDER = 0.12;
/** The bottom point. */
const TIP = 0.96;

/**
 * The outline of the shield, as an SVG path.
 *
 * A straight-edged pentagon rather than a curved heraldic shield: the node icon is drawn as small
 * as `r = 5` at depth 5 in the Mindmap, and at that size curvature is a rounding error while a
 * flat top and a hard point are still a silhouette.
 */
function shieldPath(cx: number, cy: number, r: number): string {
  const w = r * HALF_WIDTH;
  const top = cy + r * TOP;
  const shoulder = cy + r * SHOULDER;
  const tip = cy + r * TIP;
  return `M ${cx - w} ${top} L ${cx + w} ${top} L ${cx + w} ${shoulder} L ${cx} ${tip} L ${cx - w} ${shoulder} Z`;
}

/**
 * A commitment renders as a **shield**: a flat-topped, pointed badge — the shape of something
 * upheld rather than something done.
 *
 * The silhouette is the whole point. A Task is a circle, a Goal a ring of circles, a Habit a ring
 * of arrows and a Flow a pair of waves, so every other kind in the tree is round; the shield is
 * the only straight-edged, asymmetric outline among them and stays that at the smallest size the
 * Mindmap draws (`r = 5`), where an inner detail would have dissolved. A notched seal was tried
 * first and failed for exactly that reason: at the sizes the icon is drawn at, the notches
 * disappear and what is left is a circle — a Task.
 */
export default function CommitmentIcon({ cx, cy, r, color, opacity, verdict }: Props) {
  const mark = r * 0.42;
  const stroke = {
    fill: "none" as const,
    strokeWidth: r * 0.17,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const keptMark = `M ${cx - mark} ${cy} L ${cx - mark * 0.25} ${cy + mark * 0.7} L ${cx + mark} ${cy - mark * 0.75}`;

  return (
    <g opacity={opacity}>
      <path d={shieldPath(cx, cy, r)} fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinejoin="round" />
      {verdict === VERDICT.KEPT && (
        <>
          <path {...stroke} stroke="#fff" strokeOpacity={MARK_SHADE} d={keptMark} />
          <path {...stroke} stroke={color} d={keptMark} />
        </>
      )}
      {verdict === VERDICT.BROKEN && (
        <g {...stroke} stroke={color}>
          <path d={`M ${cx - mark * 0.8} ${cy - mark * 0.8} L ${cx + mark * 0.8} ${cy + mark * 0.8}`} />
          <path d={`M ${cx + mark * 0.8} ${cy - mark * 0.8} L ${cx - mark * 0.8} ${cy + mark * 0.8}`} />
        </g>
      )}
    </g>
  );
}
