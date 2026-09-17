import type { Verdict } from "@/api/commitments";
import { VERDICT } from "@/api/commitments";

interface Props { cx: number; cy: number; r: number; color: string; opacity: number; verdict?: Verdict | undefined }

/** Opacity of the white wash that lifts the verdict mark clear of the seal behind it. */
const MARK_SHADE = 0.55;

/**
 * A commitment renders as a **seal**: a ring with a notched edge, the shape a promise is stamped
 * with. Inside it sits the verdict, so what has and has not been judged is readable from the
 * canvas without opening anything.
 *
 * Deliberately not a target (a Goal) and not a check circle (a Task): a Commitment is neither
 * pursued nor done, and at a glance it must not be mistaken for either.
 */
export default function CommitmentIcon({ cx, cy, r, color, opacity, verdict }: Props) {
  const outer = r * 0.95;
  const notches = 12;
  const points = Array.from({ length: notches * 2 }, (_, i) => {
    const angle = (Math.PI * i) / notches - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : outer * 0.86;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");

  const mark = r * 0.42;
  const stroke = {
    fill: "none" as const,
    strokeWidth: r * 0.17,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <g opacity={opacity}>
      <polygon points={points} fill="none" stroke={color} strokeWidth={r * 0.16} strokeLinejoin="round" />
      {verdict === VERDICT.KEPT && (
        <path
          {...stroke}
          stroke="#fff"
          strokeOpacity={MARK_SHADE}
          d={`M ${cx - mark} ${cy} L ${cx - mark * 0.25} ${cy + mark * 0.7} L ${cx + mark} ${cy - mark * 0.75}`}
        />
      )}
      {verdict === VERDICT.KEPT && (
        <path {...stroke} stroke={color} d={`M ${cx - mark} ${cy} L ${cx - mark * 0.25} ${cy + mark * 0.7} L ${cx + mark} ${cy - mark * 0.75}`} />
      )}
      {verdict === VERDICT.BROKEN && (
        <g {...stroke} stroke={color}>
          <path d={`M ${cx - mark * 0.8} ${cy - mark * 0.8} L ${cx + mark * 0.8} ${cy + mark * 0.8}`} />
          <path d={`M ${cx + mark * 0.8} ${cy - mark * 0.8} L ${cx - mark * 0.8} ${cy + mark * 0.8}`} />
        </g>
      )}
    </g>
  );
}
