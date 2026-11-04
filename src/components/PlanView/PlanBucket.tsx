import type { DragEvent, ReactNode } from "react";
import type { PlanSection } from "@/utils/plan-sections";
import styles from "./PlanView.module.css";

interface Props {
  section: PlanSection;
  /** Whether a drag (the mouse's or a finger's) is over this bucket. */
  highlighted: boolean;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  /** The bucket's heading and the cards in it. */
  children: ReactNode;
}

/**
 * One subscope of the split planned pane, as a place a card is dropped. **The one seam of the
 * subscope layout**: how the buckets are drawn is this component's business alone. The finger's
 * drag (`usePlanTouchDrag`) knows only the `data-plan-section` attribute set here, and the mouse's
 * only the three handlers, so the layout (stacked boxes today) can change without touching either.
 */
export default function PlanBucket({ section, highlighted, onDragOver, onDragLeave, onDrop, children }: Props) {
  return (
    <div
      className={`${styles.section}${highlighted ? ` ${styles.sectionOver}` : ""}`}
      data-plan-section={section.key}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}
