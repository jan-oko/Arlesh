interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * An antenna: a bare mast with a ball on its tip, standing on a splayed base — the MCP can see
 * this node, which is inside an MCP root and not private. It reads as a connection out to the
 * agent rather than as something watching.
 *
 * Tall and open, so it stays distinct at badge size from the Agentic bot head beside it, whose
 * silhouette is a wide closed box with eyes.
 *
 * One state only. Whether the MCP may also write the node is not drawn here: inside a root, write
 * is exactly Agentic, and the bot head already says that.
 */
export default function McpIcon({ cx, cy, r, color }: Props) {
  const ballR = r * 0.26;
  const ballY = cy - r + ballR;
  const baseY = cy + r * 0.9;
  const foot = r * 0.55;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx} ${ballY + ballR} L ${cx} ${baseY}`} />
      <path d={`M ${cx - foot} ${baseY} L ${cx} ${baseY - foot} L ${cx + foot} ${baseY}`} />
      <circle cx={cx} cy={ballY} r={ballR} fill={color} stroke="none" />
    </g>
  );
}
