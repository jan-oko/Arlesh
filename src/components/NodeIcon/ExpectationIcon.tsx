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

/** One way of spacing the ticks round the ring, as fractions of the icon's radius. */
interface TickRing {
  /** Evenly spaced positions round the circle. */
  slots: number;
  /** How many of them, at the lower right, are left empty — the gap that keeps the ring open. */
  missing: number;
  inner: number;
  outer: number;
  stroke: number;
}

/** The reference's ring: 24 positions, 20 ticks, a gap of four at the lower right. */
const FULL: TickRing = { slots: 24, missing: 4, inner: 0.6, outer: 0.7, stroke: 0.075 };

/** Half as many, longer and heavier, for small icons: twenty ticks a few pixels apart blur into a
 * grey ring. 12 positions, 10 ticks, a gap of two. */
const SPARSE: TickRing = { slots: 12, missing: 2, inner: 0.58, outer: 0.76, stroke: 0.15 };

/** Below this radius the ring thins to [`SPARSE`] — every Mindmap node and every row icon today. */
const FULL_MIN_R = 16;

function ringFor(r: number): TickRing {
  return r >= FULL_MIN_R ? FULL : SPARSE;
}

/**
 * An Expectation renders as a **loading spinner that is standing still**: short radial ticks, all
 * the same weight, evenly spaced round a circle and running clockwise from six o'clock, with a few
 * left out at the lower right so the ring never closes. A wait that has not come round yet.
 *
 * The glyph shows **status only**. **Pending** is the tick ring; **Released** is the same ring with
 * a check inside — one family, and never a Task's glyph, whose rings are whole lines. **Archive is
 * not drawn here**: an archived wait is dimmed and badged exactly as every other kind is.
 *
 * Twenty ticks at full size; ten (with a gap of two) below a 16px radius, where twenty clump.
 * Round caps, no fill, monochrome in the node's glyph colour, and deliberately **not animated**.
 */
export default function ExpectationIcon({ cx, cy, r, color, opacity, status }: Props) {
  const ring = ringFor(r);
  const common: SVGProps<SVGPathElement> = {
    fill: "none", stroke: color, strokeWidth: ring.stroke * r, strokeLinecap: "round",
  };
  const step = (2 * Math.PI) / ring.slots;
  const ticks: string[] = [];
  for (let i = 0; i < ring.slots - ring.missing; i++) {
    // Clockwise from six o'clock; the slots left over are the ones just before it, at the lower right.
    const angle = Math.PI + i * step;
    const at = (radius: number) =>
      `${(cx + radius * r * Math.sin(angle)).toFixed(2)} ${(cy - radius * r * Math.cos(angle)).toFixed(2)}`;
    ticks.push(`M ${at(ring.inner)} L ${at(ring.outer)}`);
  }
  // The check sits inside the ticks' inner edge.
  const k = ring.inner * 0.72 * r;
  return (
    <g opacity={opacity}>
      {ticks.map((d) => <path key={d} data-part="tick" d={d} {...common} />)}
      {status === "released" && (
        <path
          data-part="check"
          d={`M ${cx - 0.62 * k},${cy + 0.02 * k} L ${cx - 0.12 * k},${cy + 0.5 * k} L ${cx + 0.7 * k},${cy - 0.42 * k}`}
          {...common}
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}
