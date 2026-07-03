interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A habit recurs — the Lucide "refresh-cw" glyph (ISC-licensed) reads as "repeating cycle".
// Lucide authors in a 24×24 box centered at (12,12); we translate+scale it onto the node. The
// box stroke-width is chosen so that, once scaled, the on-screen weight matches the sibling icons
// (r * 0.2): scale = r * 1.5 / 24, so box width r*0.2 / scale = 3.2 regardless of node radius.
export default function HabitIcon({ cx, cy, r, color, opacity }: Props) {
  const scale = (r * 1.5) / 24; // the glyph spans ~1.5r across, like the other node icons
  return (
    <g
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)`}
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </g>
  );
}
