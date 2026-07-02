interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A flow is a stream of instances — two stacked waves read as "flow".
export default function FlowIcon({ cx, cy, r, color, opacity }: Props) {
  const hump = r * 0.7; // horizontal reach of each half-period
  const amp = r * 0.22; // vertical swing
  const gap = r * 0.42; // vertical distance between the two waves
  // One full period at height y: an up-hump reflected once into a down-hump.
  const wave = (y: number) => `M ${cx - hump} ${y} q ${hump / 2} ${-amp}, ${hump} 0 t ${hump} 0`;
  return (
    <g opacity={opacity} fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round">
      <path d={wave(cy - gap)} />
      <path d={wave(cy + gap)} />
    </g>
  );
}
