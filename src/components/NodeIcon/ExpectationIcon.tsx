import type { SVGProps } from "react";

interface Props {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
  /** `pending` or `released`. */
  status: string | undefined;
}

/** An arc of the ring, as two angles in degrees clockwise from twelve o'clock, drawn clockwise
 * from `from` to `to`. */
interface Arc {
  from: number;
  to: number;
}

/** The solid top half: from about nine o'clock over the top to about three. */
const SOLID: Arc = { from: 283, to: 437 };

/**
 * The bottom half, broken into dashes that shorten as they run from the left side round under the
 * ring to the lower right — long, medium, medium, a stub — and stop short of the solid arc, leaving
 * the ring open between about four and five o'clock. Measured off the reference drawing.
 */
const FOUR_DASHES: readonly Arc[] = [
  { from: 238, to: 257 },
  { from: 197, to: 212 },
  { from: 162, to: 171 },
  { from: 133, to: 137 },
];

/**
 * The same run with one dash fewer, for small icons: four dashes on a ring a few pixels across
 * leave sub-pixel gaps that blur into a grey smudge. Long, medium, stub, with wider gaps.
 */
const THREE_DASHES: readonly Arc[] = [
  { from: 234, to: 257 },
  { from: 181, to: 199 },
  { from: 141, to: 146 },
];

/** Below this radius the four-dash run collapses to three. At it, a gap between four dashes is
 * about 1.4px once the round caps have eaten into it; below, it drops under a pixel. */
const FOUR_DASH_MIN_R = 8;

/** A point on the ring, `degrees` clockwise from twelve o'clock. */
function pointAt(cx: number, cy: number, radius: number, degrees: number): string {
  const angle = (degrees * Math.PI) / 180;
  return `${(cx + radius * Math.sin(angle)).toFixed(2)} ${(cy - radius * Math.cos(angle)).toFixed(2)}`;
}

function arcPath(cx: number, cy: number, radius: number, arc: Arc): string {
  const large = arc.to - arc.from > 180 ? 1 : 0;
  const r = radius.toFixed(2);
  return `M ${pointAt(cx, cy, radius, arc.from)} A ${r} ${r} 0 ${large} 1 ${pointAt(cx, cy, radius, arc.to)}`;
}

/** Which dash run an icon of radius `r` draws. */
function expectationDashes(r: number): readonly Arc[] {
  return r >= FOUR_DASH_MIN_R ? FOUR_DASHES : THREE_DASHES;
}

/**
 * An Expectation renders as an **unclosed ring**: one solid arc across the top, and below it a run
 * of dashes that shorten as they go — long, medium, medium, a stub — stopping short of the solid
 * arc at the lower right, so the ring never closes. A wait that has not come round yet.
 *
 * The glyph shows **status only**. **Pending** is the ring; **Released** is the same ring with a
 * check inside — one family, and never a Task's glyph, whose To Do and Done rings are whole.
 * **Archive is not drawn here**: an archived wait is dimmed and badged exactly as every other kind
 * is.
 *
 * Every stroke has round caps, is about 8% of the icon's width, and nothing is filled. On an icon
 * small enough that four dashes would clump — the Mindmap's deeper levels — the run collapses to
 * three. **Monochrome** in the node's glyph colour, and deliberately **still**.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status }: Props) {
  const radius = r * 0.75;
  const stroke = r * 0.167;
  const common: SVGProps<SVGPathElement> = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" };
  return (
    <g opacity={opacity}>
      <path data-part="solid" d={arcPath(cx, cy, radius, SOLID)} {...common} />
      {expectationDashes(r).map((arc) => (
        <path key={arc.from} data-part="dash" d={arcPath(cx, cy, radius, arc)} {...common} />
      ))}
      {status === "released" && (
        <path
          data-part="check"
          d={`M ${cx - r * 0.34},${cy} L ${cx - r * 0.06},${cy + r * 0.28} L ${cx + r * 0.36},${cy - r * 0.24}`}
          {...common}
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}
