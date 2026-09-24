interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * An open eye: the MCP can see this node — it is inside an MCP root and not private.
 *
 * One state only. Whether the MCP may also write the node is not drawn here: inside a root, write
 * is exactly Agentic, and the Agentic bot head already says that.
 */
export default function McpIcon({ cx, cy, r, color }: Props) {
  const half = r * 0.95;
  const lid = r * 0.6;
  return (
    <g fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx - half} ${cy} Q ${cx} ${cy - lid * 1.6} ${cx + half} ${cy} Q ${cx} ${cy + lid * 1.6} ${cx - half} ${cy} Z`} />
      <circle cx={cx} cy={cy} r={r * 0.3} fill={color} stroke="none" />
    </g>
  );
}
