import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { useTagNames } from "@/hooks/use-tag-names";
import TaskIcon from "@/components/NodeIcon/TaskIcon";
import TaskRowBadges from "./TaskRowBadges";
import styles from "./TaskRow.module.css";

const ICON_R = 10;

interface Props {
  row: TaskListRow;
  isSelected: boolean;
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
 * double-clicking the node on the Mindmap. */
export default function TaskRow({
  row, isSelected, isEditingTitle, onSelect, onCycleStatus, onOpenEditor, onCommitTitle, onCancelTitleEdit,
  onAddParentFilter, onAddTagFilter,
}: Props) {
  const { t } = useTranslation(["listView", "nodeKinds"]);
  const tagNames = useTagNames();
  const inputRef = useRef<HTMLInputElement>(null);
  const { node } = row;
  const parent = row.ancestors[row.ancestors.length - 1];

  // Mirrors the Mindmap node's own gating: a Habit instance always advances; a real task only while unblocked.
  const canClickStatus = node.habitItem !== undefined || !row.isBlocked;

  // Same aspect-color derivation the Mindmap node uses, so a card's tint matches its node's fill there.
  const { fillColor, fillOpacity } = computeNodeAppearance(node, row.ancestors.length);
  const cardStyle: CSSProperties & Record<`--card-tint${string}`, string | number> = {
    "--card-tint": fillColor,
    "--card-tint-opacity": fillOpacity,
  };

  useEffect(() => {
    if (!isEditingTitle) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  return (
    <div
      className={`${styles.card}${isSelected ? ` ${styles.cardSelected}` : ""}`}
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
