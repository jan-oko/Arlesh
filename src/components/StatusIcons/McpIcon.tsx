interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * An antenna: a mast on a small base with a signal arc either side of its tip — the MCP can see
 * this node, which is inside an MCP root and not private. It reads as broadcast, a connection out
 * to the agent, rather than as something watching.
 *
 * Open strokes only, so it stays distinct at badge size from the Agentic bot head beside it,
 * whose silhouette is a closed box with eyes.
 *
 * One state only. Whether the MCP may also write the node is not drawn here: inside a root, write
 * is exactly Agentic, and the bot head already says that.
 */
export default function McpIcon({ cx, cy, r, color }: Props) {
  const tipY = cy - r * 0.35;
  const baseY = cy + r * 0.9;
  const foot = r * 0.45;
  const near = r * 0.42;
  const far = r * 0.8;
  const arc = (radius: number, side: 1 | -1) => {
    const x = cx + side * radius * 0.7;
    return `M ${x} ${tipY - radius * 0.7} A ${radius} ${radius} 0 0 ${side === 1 ? 1 : 0} ${x} ${tipY + radius * 0.7}`;
  };
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx} ${tipY} L ${cx} ${baseY}`} />
      <path d={`M ${cx - foot} ${baseY} L ${cx} ${baseY - foot} L ${cx + foot} ${baseY}`} />
      <circle cx={cx} cy={tipY} r={r * 0.14} fill={color} stroke="none" />
      <path d={arc(near, 1)} />
      <path d={arc(near, -1)} />
      <path d={arc(far, 1)} />
      <path d={arc(far, -1)} />
    </g>
  );
}
