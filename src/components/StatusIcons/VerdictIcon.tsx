import type { Verdict } from "@/api/commitments";
import { VERDICT } from "@/api/commitments";

interface Props { cx: number; cy: number; r: number; color: string; verdict: Verdict }

/**
 * A Commitment's verdict, as three visibly distinct marks: a tick for **kept**, a cross for
 * **broken**, and an open circle for **unresolved**.
 *
 * The three are drawn at the same weight on purpose. Kept and Broken are equal outcomes rather
 * than a success and a failure state, and Unresolved is a mark of its own rather than an absence
 * — "you have not said" is information, and rendering it as blank space would lose it.
 */
export default function VerdictIcon({ cx, cy, r, color, verdict }: Props) {
  const stroke = { fill: "none", stroke: color, strokeWidth: r * 0.28, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (verdict === VERDICT.KEPT) {
    return <path {...stroke} d={`M ${cx - r * 0.7} ${cy} L ${cx - r * 0.2} ${cy + r * 0.55} L ${cx + r * 0.75} ${cy - r * 0.6}`} />;
  }
  if (verdict === VERDICT.BROKEN) {
    const a = r * 0.6;
    return (
      <g {...stroke}>
        <path d={`M ${cx - a} ${cy - a} L ${cx + a} ${cy + a}`} />
        <path d={`M ${cx + a} ${cy - a} L ${cx - a} ${cy + a}`} />
      </g>
    );
  }
  return <circle {...stroke} cx={cx} cy={cy} r={r * 0.7} strokeDasharray={`${r * 0.5} ${r * 0.38}`} />;
}
