/** The side of the screen a display cutout (a camera hole, a notch) is cut from. */
export type CutoutSide = "left" | "right" | "top" | "bottom";

/**
 * What a cutout covers along one side, in CSS px: the span along that side (`start` to `end`, from
 * the top for the left and right sides, from the left for the top and bottom) and how far it
 * reaches in. Zero depth: nothing there.
 */
export interface CutoutBand {
  start: number;
  end: number;
  depth: number;
}

/** The keep-out bands along each side: the cutout's and, in Full screen, the rounded corners'. */
export type CutoutBands = Record<CutoutSide, readonly CutoutBand[]>;

/** A box in viewport CSS px, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far in from each of its edges a box's content must start to clear the cutout, in px; 0 on a
 * side the cutout does not reach.
 */
export interface Clearance {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_CLEARANCE: Clearance = { left: 0, right: 0, top: 0, bottom: 0 };

const SIDES: readonly CutoutSide[] = ["left", "right", "top", "bottom"];

/** A CSS length in px (`"12.5px"`) as a number; 0 for anything else, including an unset variable. */
export function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** How far in from a corner's own edges a box must start to lie inside its arc: 1 - 1/sqrt 2, rounded up. */
const CORNER_REACH = 0.3;

/** Where the screen's four corners are, as `--corner-tl|tr|br|bl` radii, for the bands they leave. */
function cornerBands(style: CSSStyleDeclaration, viewport: { width: number; height: number }): CutoutBands {
  const radius = (corner: string) => parsePx(style.getPropertyValue(`--corner-${corner}`));
  const [tl, tr, br, bl] = [radius("tl"), radius("tr"), radius("br"), radius("bl")];
  const band = (start: number, end: number, r: number): readonly CutoutBand[] =>
    r > 0 ? [{ start, end, depth: r * CORNER_REACH }] : [];
  const { width, height } = viewport;
  return {
    left: [...band(0, tl, tl), ...band(height - bl, height, bl)],
    right: [...band(0, tr, tr), ...band(height - br, height, br)],
    top: [...band(0, tl, tl), ...band(width - tr, width, tr)],
    bottom: [...band(0, bl, bl), ...band(width - br, width, br)],
  };
}

/**
 * The bands the Android activity pushed as `--cutout-<side>-start|end|depth`, 0 where it pushed
 * none. With `withCorners` (Full screen, where nothing covers the corners) the rounded corners'
 * radii, `--corner-*`, add a band each: a box must stay inside the arc, too.
 */
export function readCutoutBands(
  style: CSSStyleDeclaration,
  viewport: { width: number; height: number },
  withCorners: boolean,
): CutoutBands {
  const cutout = (side: CutoutSide): readonly CutoutBand[] => [{
    start: parsePx(style.getPropertyValue(`--cutout-${side}-start`)),
    end: parsePx(style.getPropertyValue(`--cutout-${side}-end`)),
    depth: parsePx(style.getPropertyValue(`--cutout-${side}-depth`)),
  }];
  const corners = withCorners ? cornerBands(style, viewport) : null;
  const along = (side: CutoutSide) => [...cutout(side), ...(corners?.[side] ?? [])].filter((band) => band.depth > 0);
  return { left: along("left"), right: along("right"), top: along("top"), bottom: along("bottom") };
}

/** Whether any side has a band. */
export function hasCutout(bands: CutoutBands): boolean {
  return SIDES.some((side) => bands[side].length > 0);
}

/** Whether the range `a0..a1` overlaps `b0..b1`, touching ends not counting. */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

/**
 * How far a box's content must be kept in from each edge so that it does not sit under a cutout. A
 * side counts only when the box overlaps the cutout's span along it, so a row below the camera, or
 * a bar above it, is left alone; and the distance is what a band reaches in beyond where the box
 * already starts.
 */
export function clearanceFor(box: Box, bands: CutoutBands, viewport: { width: number; height: number }): Clearance {
  const along = (side: CutoutSide, extent: (band: CutoutBand) => number): number =>
    Math.max(
      0,
      ...bands[side]
        .filter((band) => (side === "left" || side === "right"
          ? overlaps(box.top, box.bottom, band.start, band.end)
          : overlaps(box.left, box.right, band.start, band.end)))
        .map(extent),
    );
  return {
    left: along("left", (band) => band.depth - box.left),
    right: along("right", (band) => box.right - (viewport.width - band.depth)),
    top: along("top", (band) => band.depth - box.top),
    bottom: along("bottom", (band) => box.bottom - (viewport.height - band.depth)),
  };
}

/** The properties a box's clearance is written to, for its CSS to pad by. */
const CLEARANCE_PROPERTIES = {
  left: "--clear-left",
  right: "--clear-right",
  top: "--clear-top",
  bottom: "--clear-bottom",
} as const satisfies Record<CutoutSide, string>;

/**
 * Writes an element's clearance to `--clear-left|right|top|bottom` on it, in px. It pads by them
 * with `max(its own padding, var(--clear-left, 0px))`, so no cutout leaves it exactly as it was.
 * Padding does not move the box, so measuring it again gives the same answer.
 */
export function writeClearance(element: HTMLElement, bands: CutoutBands): void {
  const clearance = hasCutout(bands)
    ? clearanceFor(element.getBoundingClientRect(), bands, { width: window.innerWidth, height: window.innerHeight })
    : NO_CLEARANCE;
  for (const side of SIDES) element.style.setProperty(CLEARANCE_PROPERTIES[side], `${clearance[side]}px`);
}
