interface Props { cx: number; cy: number; r: number; color: string; opacity: number; }

// A flow is a stream of instances — a double sine reads as "flow".
export default function FlowIcon({ cx, cy, r, color, opacity }: Props) {
  const hump = r * 0.45; // horizontal reach of each half-period
  const amp = r * 0.4; // vertical swing
  // Start with an up-hump, then reflect three times: down, up, down → two full periods.
  const d = `M ${cx - hump * 2} ${cy} q ${hump / 2} ${-amp}, ${hump} 0 t ${hump} 0 t ${hump} 0 t ${hump} 0`;
  return (
    <g opacity={opacity}>
      <path d={d} fill="none" stroke={color} strokeWidth={r * 0.22} strokeLinecap="round" />
    </g>
  );
}
