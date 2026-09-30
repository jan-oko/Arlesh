import { Fragment, useEffect, useId, useRef } from "react";
import type { CSSProperties } from "react";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { aspectWashStyle } from "@/utils/node-visuals";
import type { ZenTextSize } from "@/utils/zen-grid";
import { useInputCapture } from "@/hooks/use-input-capture";
import TaskRowBadges from "@/components/ListView/TaskRowBadges";
import OverdueNote from "@/components/OverdueNote/OverdueNote";
import { isOverdue } from "@/utils/overdue";
import styles from "./ZenTaskCard.module.css";

const PATH_SEPARATOR = " › ";

interface Props {
  row: TaskListRow;
  width: number;
  height: number;
  text: ZenTextSize;
  showBadges: boolean;
  /** Whether an Overdue card draws its amber border — the Zen setting. Its description says Overdue
   * either way. */
  showOverdueBorder: boolean;
  isSelected: boolean;
  /** Held on screen only because it is selected: the filter would have dropped it. Dimmed. */
  isFocusExempt: boolean;
  isEditingTitle: boolean;
  onSelect: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onCommitTitle: (nodeId: string, title: string) => void;
  onCancelTitleEdit: () => void;
}

/**
 * One Task in the Zen View's grid: its title, large; the path to it, small, beneath; and — when the
 * card is tall enough and the setting allows — the badge row every other view draws, from the same
 * component. Washed in its aspect's colour like a List row or a Steps card.
 *
 * The three are **centred** on the card, across and down, and scale together: the path and the
 * badges keep to the title's proportions (see `zenTextSize`). The title is `dir="auto"`, so a Hebrew
 * title reads right to left; the path line is left to right with each title isolated — the Plan
 * View's rule — because `›` is mirrored between two right-to-left titles otherwise. Centred, both
 * sit under the title whatever its direction.
 *
 * A click selects, a double click opens the editor; there is no status control (Enter is the
 * gesture). `R` swaps the title for an inline input, as a List row does.
 */
export default function ZenTaskCard({
  row, width, height, text, showBadges, showOverdueBorder, isSelected, isFocusExempt, isEditingTitle,
  onSelect, onOpenEditor, onCommitTitle, onCancelTitleEdit,
}: Props) {
  useInputCapture(isEditingTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const overdueNoteId = useId();
  const { node } = row;
  const overdue = isOverdue(node);

  useEffect(() => {
    if (!isEditingTitle) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    ...aspectWashStyle(node.color),
    width,
    height,
    "--zen-title-size": `${text.title}px`,
    "--zen-path-size": `${text.path}px`,
    "--zen-badge-size": `${text.badge}px`,
    "--zen-padding": `${text.padding}px`,
    "--zen-title-lines": text.titleLines,
  };

  return (
    <div
      className={`${styles.card}${overdue && showOverdueBorder ? ` ${styles.cardOverdue}` : ""}${isSelected ? ` ${styles.cardSelected}` : ""}${isFocusExempt ? ` ${styles.cardFocusExempt}` : ""}`}
      data-row-id={node.id}
      aria-describedby={overdue ? overdueNoteId : undefined}
      data-zen-card="task"
      aria-current={isSelected ? "true" : undefined}
      style={cardStyle}
      title={node.title}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      {overdue && <OverdueNote id={overdueNoteId} />}
      {isEditingTitle ? (
        <input
          ref={inputRef}
          type="text"
          dir="auto"
          className={styles.titleInput}
          defaultValue={node.title}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); onCommitTitle(node.id, event.currentTarget.value); }
            if (event.key === "Escape") { event.stopPropagation(); onCancelTitleEdit(); }
          }}
          onBlur={(event) => onCommitTitle(node.id, event.currentTarget.value)}
        />
      ) : (
        <span className={styles.title} dir="auto">{node.title}</span>
      )}
      {row.ancestors.length > 0 && (
        <span className={styles.path} dir="ltr">
          {row.ancestors.map((ancestor, index) => (
            <Fragment key={ancestor.id}>
              {index > 0 && PATH_SEPARATOR}
              <bdi>{ancestor.title}</bdi>
            </Fragment>
          ))}
        </span>
      )}
      {showBadges && (
        <span className={styles.badges}>
          <TaskRowBadges node={node} indicators={deriveStatusIndicators(node)} />
        </span>
      )}
    </div>
  );
}
