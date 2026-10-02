interface Props { cx: number; cy: number; r: number; color: string; }

/**
 * A paper plane: the Task has been sent off — someone else, a Person or the Agent, holds it. One
 * glyph for every delegate for now (ruled by the user, 2026-10-02); who holds it is in the tooltip.
 *
 * Drawn from a 24-unit reference (`M21 3L10 14M21 3l-7 18-4-7-7-4z`, stroke 2), centred on the
 * badge's circle and scaled so the drawing's 18-unit span fills its diameter.
 */
export default function DelegatedIcon({ cx, cy, r, color }: Props) {
  const scale = r / 9;
  const x = (u: number) => cx + (u - 12) * scale;
  const y = (u: number) => cy + (u - 12) * scale;
  const path = [
    `M ${x(21)} ${y(3)} L ${x(10)} ${y(14)}`,
    `M ${x(21)} ${y(3)} L ${x(14)} ${y(21)} L ${x(10)} ${y(14)} L ${x(3)} ${y(10)} Z`,
  ].join(" ");
  return (
    <path
      data-glyph="delegated"
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={r * 0.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
