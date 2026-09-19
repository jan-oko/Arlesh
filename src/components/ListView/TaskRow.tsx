import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { isRtlText } from "@/utils/text-direction";
import { useTagNames } from "@/hooks/use-tag-names";
import { useInputCapture } from "@/hooks/use-input-capture";
import TaskIcon from "@/components/NodeIcon/TaskIcon";
import TaskRowBadges from "./TaskRowBadges";
import styles from "./TaskRow.module.css";

const ICON_R = 10;

interface Props {
  row: TaskListRow;
  visibleDepth: number;
  isSelected: boolean;
  /** In the list only because it is selected: the filter would have dropped it, so it renders dimmed. */
  isFocusExempt: boolean;
  isEditingTitle: boolean;
  onSelect: (nodeId: string) => void;
  onCycleStatus: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onCommitTitle: (nodeId: string, title: string) => void;
  onCancelTitleEdit: () => void;
  onAddParentFilter: (parentRef: string) => void;
  onAddTagFilter: (tagId: number) => void;
}

/** A compact card row for one Task: a status control (mirrors the Mindmap node's own glyph and click
 * behavior), the title (or an inline rename input, keyboard "R"), its status-icon badges, and clickable
 * parent/tag labels (SPEC: clicking either inline adds it as a filter). Clicking anywhere on the card
 * selects it (for keyboard navigation/actions); double-clicking opens the Task editor, same as
 * double-clicking the node on the Mindmap.
 *
 * `visibleDepth` is how many of the task's ancestors are themselves rows above it, and the whole card
 * steps in once per level — the status control, badges and tint move as one object rather than the
 * title drifting away from them. Ancestors the filter hides are named in the path header instead, so
 * a row never indents under something that is not on screen. */
export default function TaskRow({
  row, visibleDepth, isSelected, isFocusExempt, isEditingTitle, onSelect, onCycleStatus, onOpenEditor, onCommitTitle, onCancelTitleEdit,
  onAddParentFilter, onAddTagFilter,
}: Props) {
  useInputCapture(isEditingTitle);
  const { t } = useTranslation(["listView", "nodeKinds"]);
  const tagNames = useTagNames();
  const inputRef = useRef<HTMLInputElement>(null);
  const { node } = row;
  const parent = row.ancestors[row.ancestors.length - 1];

  // Mirrors the Mindmap node's own gating: a Habit instance always advances; a real task only while unblocked.
  const canClickStatus = node.habitItem !== undefined || !row.isBlocked;

  // Same aspect-color derivation the Mindmap node uses, so a card's tint matches its node's fill there.
  const { fillColor, fillOpacity } = computeNodeAppearance(node, row.ancestors.length);
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    "--card-tint": fillColor,
    "--card-tint-opacity": fillOpacity,
    "--row-depth": visibleDepth,
  };
  // The indent follows the title's own direction, the same way a Mindmap node's layout does: a Hebrew
  // task in an otherwise left-to-right list steps in from the edge its text starts at.
  const indentClass = isRtlText(node.title) ? styles.indentRtl : styles.indentLtr;

  useEffect(() => {
    if (!isEditingTitle) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  return (
    <div
      className={`${styles.card} ${indentClass}${isSelected ? ` ${styles.cardSelected}` : ""}${isFocusExempt ? ` ${styles.cardFocusExempt}` : ""}`}
      style={cardStyle}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <button
        type="button"
        className={styles.statusButton}
        disabled={!canClickStatus}
        aria-label={t("cycleStatus")}
        onClick={() => onCycleStatus(node.id)}
      >
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
          <TaskIcon cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--text-primary)" opacity={1} status={node.status} isBlocked={row.isBlocked} />
        </svg>
      </button>

      <div className={styles.main}>
        <div className={styles.titleRow}>
          {isEditingTitle ? (
            <input
              ref={inputRef}
              type="text"
              className={styles.titleInput}
              defaultValue={node.title}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onCommitTitle(node.id, e.currentTarget.value); }
                if (e.key === "Escape") { e.stopPropagation(); onCancelTitleEdit(); }
              }}
              onBlur={(e) => onCommitTitle(node.id, e.currentTarget.value)}
            />
          ) : (
            <button type="button" className={styles.title} onClick={() => onOpenEditor(node.id)}>
              {node.title}
            </button>
          )}
          <TaskRowBadges node={node} indicators={deriveStatusIndicators(node)} />
        </div>

        {(parent !== undefined || node.tagIds.length > 0) && (
          <div className={styles.metaRow}>
            {parent !== undefined && (
              <button
                type="button"
                className={styles.parentLabel}
                title={t("filterByParent")}
                onClick={() => onAddParentFilter(row.parentRef)}
              >
                {parent.title}
              </button>
            )}
            {node.tagIds.map((tagId) => (
              <button
                key={tagId}
                type="button"
                className={styles.tagPill}
                title={t("filterByTag")}
                onClick={() => onAddTagFilter(tagId)}
              >
                {tagNames.get(tagId) ?? `#${tagId}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
