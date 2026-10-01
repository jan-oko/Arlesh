interface Props { cx: number; cy: number; r: number; color: string; }

/** Scales a point of the 24-unit drawing below onto the badge's circle. */
function at(cx: number, cy: number, r: number): (x: number, y: number) => [number, number] {
  const scale = r / 11;
  return (x, y) => [cx + (x - 12) * scale, cy + (y - 12) * scale];
}

/**
 * Delegated to the Agent: the agents' bot head from the top bar — ears, and a ball on its antenna —
 * so it reads as the same agent the top bar's status row counts. Unlike the Agentic badge's plain
 * head, which says the work *suits* an agent, this one says the agent *holds* it.
 */
export default function DelegatedAgentIcon({ cx, cy, r, color }: Props) {
  const p = at(cx, cy, r);
  const scale = r / 11;
  const [left, top] = p(4, 8);
  const [antennaX, antennaTop] = p(12, 5);
  const [, antennaBottom] = p(12, 8);
  const [leftEar, earTop] = p(2, 13);
  const [rightEar, earBottom] = p(22, 16);
  const [ballX, ballY] = p(12, 4);
  const [leftEye, eyeY] = p(9, 14);
  const [rightEye] = p(15, 14);
  return (
    <g data-glyph="delegated-agent">
      <g fill="none" stroke={color} strokeWidth={r * 0.18} strokeLinecap="round" strokeLinejoin="round">
        <rect x={left} y={top} width={16 * scale} height={12 * scale} rx={3 * scale} />
        <path d={`M ${antennaX} ${antennaBottom} L ${antennaX} ${antennaTop}`} />
        <path d={`M ${leftEar} ${earTop} L ${leftEar} ${earBottom} M ${rightEar} ${earTop} L ${rightEar} ${earBottom}`} />
      </g>
      <circle cx={ballX} cy={ballY} r={1.4 * scale} fill={color} />
      <circle cx={leftEye} cy={eyeY} r={1.3 * scale} fill={color} />
      <circle cx={rightEye} cy={eyeY} r={1.3 * scale} fill={color} />
    </g>
  );
}
