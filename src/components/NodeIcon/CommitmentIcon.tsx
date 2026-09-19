import type { CommitmentGlyphState } from "@/utils/commitment-glyph";
import { COMMITMENT_GLYPH } from "@/utils/commitment-glyph";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; state: CommitmentGlyphState }

/** A corner, in units of the icon radius, relative to the icon centre. */
type Corner = readonly [number, number];

/** Half-width of the shield. */
const HALF_WIDTH = 0.74;
/** The shield's flat top edge. */
const TOP = -0.86;
/** Where the straight sides stop and the point begins. */
const SHOULDER = 0.12;
/** The bottom point. */
const TIP = 0.96;

const TOP_LEFT: Corner = [-HALF_WIDTH, TOP];
const TOP_RIGHT: Corner = [HALF_WIDTH, TOP];
const RIGHT_SHOULDER: Corner = [HALF_WIDTH, SHOULDER];
const BOTTOM_POINT: Corner = [0, TIP];
const LEFT_SHOULDER: Corner = [-HALF_WIDTH, SHOULDER];

const SHIELD: readonly Corner[] = [TOP_LEFT, TOP_RIGHT, RIGHT_SHOULDER, BOTTOM_POINT, LEFT_SHOULDER];

// The jagged line a broken shield parts along: down from the top edge, back and forth, to the point.
const CRACK_TOP: Corner = [0.12, TOP];
const CRACK_LEFT: Corner = [-0.2, -0.28];
const CRACK_RIGHT: Corner = [0.16, 0.3];

const BROKEN_LEFT: readonly Corner[] =
  [TOP_LEFT, CRACK_TOP, CRACK_LEFT, CRACK_RIGHT, BOTTOM_POINT, LEFT_SHOULDER];
const BROKEN_RIGHT: readonly Corner[] =
  [CRACK_TOP, TOP_RIGHT, RIGHT_SHOULDER, BOTTOM_POINT, CRACK_RIGHT, CRACK_LEFT];

/** How far each half of a broken shield is pulled off the crack. */
const CLEFT = 0.13;

/** Renders unit-radius corners as an SVG `points` list around `(cx, cy)`, shifted sideways by `dx`. */
function points(corners: readonly Corner[], cx: number, cy: number, r: number, dx = 0): string {
  return corners
    .map(([x, y]) => `${(cx + r * (x + dx)).toFixed(2)},${(cy + r * y).toFixed(2)}`)
    .join(" ");
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
 *
 * The four states vary the shield itself rather than putting a mark inside it, for the same
 * reason. **Whether it is filled** says whether the commitment has been judged — hollow while the
 * answer is still owed, solid once it is given — and that much reads at any size at all. A second
 * mark separates the two states within each pair: the solid shield is **split by a cleft** when
 * the commitment was broken, and the hollow one is **struck through** when its Verdict Window ran
 * out unanswered. Kept and Broken are drawn in the node's own colour, never in red — they are
 * equal outcomes, not a success and a failure.
 */
export default function CommitmentIcon({ cx, cy, r, color, opacity, state }: Props) {
  if (state === COMMITMENT_GLYPH.BROKEN) {
    // Two pieces of one shield, each pulled clear of the crack. Solid rather than hollow, so the
    // split reads as a bright line through a mass: a hairline between two outlines would close up
    // at the sizes this is actually drawn at.
    return (
      <g opacity={opacity} fill={color} stroke={color} strokeWidth={r * 0.14} strokeLinejoin="round">
        <polygon points={points(BROKEN_LEFT, cx, cy, r, -CLEFT)} />
        <polygon points={points(BROKEN_RIGHT, cx, cy, r, CLEFT)} />
      </g>
    );
  }

  const strike = r * 0.95;
  return (
    <g opacity={opacity}>
      <polygon
        points={points(SHIELD, cx, cy, r)}
        fill={state === COMMITMENT_GLYPH.KEPT ? color : "none"}
        stroke={color}
        strokeWidth={r * 0.2}
        strokeLinejoin="round"
      />
      {state === COMMITMENT_GLYPH.EXPIRED && (
        <path
          d={`M ${cx - strike} ${cy + strike * 0.75} L ${cx + strike} ${cy - strike * 0.75}`}
          stroke={color}
          strokeWidth={r * 0.22}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
