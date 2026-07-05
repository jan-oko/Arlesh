import { useTranslation } from "react-i18next";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { useTagNames } from "@/hooks/use-tag-names";
import TaskIcon from "@/components/NodeIcon/TaskIcon";
import TaskRowBadges from "./TaskRowBadges";
import styles from "./TaskRow.module.css";

const ICON_R = 10;

interface Props {
  row: TaskListRow;
  onCycleStatus: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onAddParentFilter: (parentRef: string) => void;
  onAddTagFilter: (tagId: number) => void;
}

/** A compact card row for one Task: a status control (mirrors the Mindmap node's own glyph and click
 * behavior), the title, its status-icon badges, and clickable parent/tag labels (SPEC: clicking either
 * inline adds it as a filter). */
export default function TaskRow({ row, onCycleStatus, onOpenEditor, onAddParentFilter, onAddTagFilter }: Props) {
  const { t } = useTranslation(["listView", "nodeKinds"]);
  const tagNames = useTagNames();
  const { node } = row;
  const parent = row.ancestors[row.ancestors.length - 1];

  // Mirrors the Mindmap node's own gating: a Habit instance always advances; a real task only while unblocked.
  const canClickStatus = node.habitItem !== undefined || !row.isBlocked;

  return (
    <div className={styles.card}>
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
          <button type="button" className={styles.title} onClick={() => onOpenEditor(node.id)}>
            {node.title}
          </button>
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
