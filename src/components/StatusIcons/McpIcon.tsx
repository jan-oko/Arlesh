interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * An antenna: a filled emitter dot on top of one straight mast, with a signal arc either side
 * radiating from that dot — the classic broadcast mark. The MCP can see this node, which is inside
 * an MCP root and not private. It reads as a connection out to the agent rather than as something
 * watching.
 *
 * A single line, a dot and two open arcs, so it stays distinct at badge size from the Agentic bot
 * head beside it, whose silhouette is a wide closed box with eyes.
 *
 * One state only. Whether the MCP may also write the node is not drawn here: inside a root, write
 * is exactly Agentic, and the bot head already says that.
 */
export default function McpIcon({ cx, cy, r, color }: Props) {
  const emitterY = cy - r * 0.4;
  const emitterR = r * 0.17;
  const arcR = r * 0.58;
  // The arcs are quarter-circles centred on the emitter: each runs from 45° above to 45° below it.
  const reach = arcR * Math.SQRT1_2;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round">
      <path d={`M ${cx} ${emitterY + emitterR} L ${cx} ${cy + r * 0.95}`} />
      <circle cx={cx} cy={emitterY} r={emitterR} fill={color} stroke="none" />
      <path d={`M ${cx + reach} ${emitterY - reach} A ${arcR} ${arcR} 0 0 1 ${cx + reach} ${emitterY + reach}`} />
      <path d={`M ${cx - reach} ${emitterY - reach} A ${arcR} ${arcR} 0 0 0 ${cx - reach} ${emitterY + reach}`} />
    </g>
  );
}
