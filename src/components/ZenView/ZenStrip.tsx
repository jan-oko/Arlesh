import type { ReactNode } from "react";
import type { MindmapNode } from "@/utils/tree-layout";
import ZenStripCard from "./ZenStripCard";
import styles from "./ZenStrip.module.css";

interface Props {
  /** The strip's accessible name — "Commitments" or "Expectations". */
  label: string;
  nodes: readonly MindmapNode[];
  renderGlyph: (node: MindmapNode, r: number) => ReactNode;
  selectedId: string | null;
  exemptedIds: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
}

/**
 * One of the Zen View's two strips: a single row of small cards above the grid that scrolls sideways
 * when it is longer than the window. With nothing in it, it is not drawn at all — the grid takes the
 * space. It carries no heading: the glyphs already say which kind it holds.
 */
export default function ZenStrip({ label, nodes, renderGlyph, selectedId, exemptedIds, onSelect, onOpenEditor }: Props) {
  if (nodes.length === 0) return null;
  return (
    <section className={styles.strip} aria-label={label}>
      {nodes.map((node) => (
        <ZenStripCard
          key={node.id}
          node={node}
          renderGlyph={(r) => renderGlyph(node, r)}
          isSelected={node.id === selectedId}
          isFocusExempt={exemptedIds.has(node.id)}
          onSelect={onSelect}
          onOpenEditor={onOpenEditor}
        />
      ))}
    </section>
  );
}
