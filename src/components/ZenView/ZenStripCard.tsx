import type { CSSProperties, ReactNode } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import { aspectWashStyle } from "@/utils/node-visuals";
import StatusStepButton from "@/components/StatusStepButton/StatusStepButton";
import styles from "./ZenStrip.module.css";

const ICON_R = 9;

interface Props {
  node: MindmapNode;
  /** The kind's glyph, drawn in a `2 × ICON_R` square — the Commitment's verdict or the wait's state. */
  renderGlyph: (r: number) => ReactNode;
  isSelected: boolean;
  isFocusExempt: boolean;
  onSelect: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  /** A tap on the glyph: judges the Commitment or releases the wait, as `Enter` does. */
  onStepGlyph: (nodeId: string) => void;
  /** The control's accessible name. */
  stepLabel: string;
}

/**
 * One small card in a Zen strip: the kind's glyph and the title, aspect-washed. A click selects and
 * a double click opens the editor, as on a task card; `Enter` is what judges or releases it.
 */
export default function ZenStripCard({ node, renderGlyph, isSelected, isFocusExempt, onSelect, onOpenEditor, onStepGlyph, stepLabel }: Props) {
  const style: CSSProperties & Record<`--${string}`, string> = { ...aspectWashStyle(node.color) };
  return (
    <div
      className={`${styles.card}${isSelected ? ` ${styles.cardSelected}` : ""}${isFocusExempt ? ` ${styles.cardFocusExempt}` : ""}`}
      data-row-id={node.id}
      data-pending={node.pending === true ? "" : undefined}
      data-zen-card={node.kind}
      aria-current={isSelected ? "true" : undefined}
      style={style}
      title={node.title}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <StatusStepButton label={stepLabel} onStep={() => onStepGlyph(node.id)}>
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
          {renderGlyph(ICON_R)}
        </svg>
      </StatusStepButton>
      <span className={styles.title} dir="auto">{node.title}</span>
    </div>
  );
}
