interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// Three stacked bars: a pile of Habit iterations folded into one node. Deliberately unlike the
// cyclical Habit glyph — this is not another iteration, it is the history standing in for several.
// Authored in the same 24×24 box the other node icons use, translated and scaled onto the node.
export default function HabitGroupIcon({ cx, cy, r, color, opacity }: Props) {
  const scale = (r * 1.5) / 24;
  return (
    <g
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(-12 -12)`}
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      strokeLinecap="round"
      opacity={opacity}
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </g>
  );
}
