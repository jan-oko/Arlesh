import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CommitmentListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { useTagNames } from "@/hooks/use-tag-names";
import { VERDICT } from "@/api/verdict";
import VerdictIcon from "@/components/StatusIcons/VerdictIcon";
import TaskRowBadges from "./TaskRowBadges";
import taskStyles from "./TaskRow.module.css";
import styles from "./CommitmentRow.module.css";

const ICON_R = 10;

interface Props {
  row: CommitmentListRow;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
  onMarkKept: (nodeId: string) => void;
  onMarkBroken: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onAddTagFilter: (tagId: number) => void;
}

/**
 * One Commitment, in the section above the task rows.
 *
 * Two controls, a tick and a cross, rather than the task row's single cycling status control.
 * The two outcomes are visibly equal and sit side by side, so recording Broken is a deliberate
 * press rather than one step past Kept — and pressing the control that is already lit clears the
 * verdict, which is how a misclick is taken back.
 */
export default function CommitmentRow({
  row, isSelected, onSelect, onMarkKept, onMarkBroken, onOpenEditor, onAddTagFilter,
}: Props) {
  const { t } = useTranslation("listView");
  const tagNames = useTagNames();
  const { node } = row;
  const verdict = node.verdict ?? VERDICT.UNRESOLVED;

  const { fillColor, fillOpacity } = computeNodeAppearance(node, row.ancestors.length);
  const cardStyle: CSSProperties & Record<`--card-tint${string}`, string | number> = {
    "--card-tint": fillColor,
    "--card-tint-opacity": fillOpacity,
  };

  const control = (
    pressed: typeof VERDICT.KEPT | typeof VERDICT.BROKEN,
    onPress: (nodeId: string) => void,
  ) => {
    const active = verdict === pressed;
    return (
      <button
        type="button"
        className={`${styles.verdictButton}${active ? ` ${styles.verdictButtonActive}` : ""}`}
        aria-pressed={active}
        aria-label={active ? t("clearVerdict") : t(pressed === VERDICT.KEPT ? "markKept" : "markBroken")}
        onClick={(e) => { e.stopPropagation(); onPress(node.id); }}
      >
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
          <VerdictIcon
            cx={ICON_R}
            cy={ICON_R}
            r={ICON_R * 0.9}
            color={pressed === VERDICT.BROKEN ? "var(--danger)" : "var(--text-primary)"}
            verdict={pressed}
          />
        </svg>
      </button>
    );
  };

  return (
    <div
      className={
        `${taskStyles.card}${isSelected ? ` ${taskStyles.cardSelected}` : ""}` +
        (verdict === VERDICT.UNRESOLVED ? ` ${styles.unjudged}` : "")
      }
      // Same marker the task rows carry: the commitments band scrolls in the same container, so a
      // selected Commitment is brought into view by exactly the same code.
      data-row-id={node.id}
      style={cardStyle}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <div className={styles.verdictControls}>
        {control(VERDICT.KEPT, onMarkKept)}
        {control(VERDICT.BROKEN, onMarkBroken)}
      </div>

      <div className={taskStyles.main}>
        <div className={taskStyles.titleRow}>
          <button type="button" className={taskStyles.title} onClick={() => onOpenEditor(node.id)}>
            {node.title}
          </button>
          <TaskRowBadges node={node} indicators={deriveStatusIndicators(node)} />
        </div>

        {node.tagIds.length > 0 && (
          <div className={taskStyles.metaRow}>
            {node.tagIds.map((tagId) => (
              <button
                key={tagId}
                type="button"
                className={taskStyles.tagPill}
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
