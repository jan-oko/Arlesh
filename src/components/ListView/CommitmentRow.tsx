import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CommitmentListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { aspectWashStyle } from "@/utils/node-visuals";
import { commitmentGlyphState } from "@/utils/commitment-glyph";
import { isRtlText } from "@/utils/text-direction";
import { useTagNames } from "@/hooks/use-tag-names";
import CommitmentIcon from "@/components/NodeIcon/CommitmentIcon";
import TaskRowBadges from "./TaskRowBadges";
import taskStyles from "./TaskRow.module.css";

const ICON_R = 10;

interface Props {
  row: CommitmentListRow;
  /** Indentation, when drawn among the task rows; 0 in the band. */
  visibleDepth?: number;
  isSelected: boolean;
  /** Kept only by the focus exemption — the selected row your own edit stopped matching. Dimmed. */
  isFocusExempt?: boolean;
  onSelect: (nodeId: string) => void;
  /** Advances the verdict one step: Unresolved → Kept → Broken → Unresolved. */
  onCycleVerdict: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onAddTagFilter: (tagId: number) => void;
}

/**
 * One Commitment, in its band or among the task rows — drawn and worked exactly like a task row.
 *
 * The status control is the node's own glyph, as a task row's is, and a click on it cycles the
 * verdict the way Enter does. The band once drew two controls, a tick and a cross, to make the two
 * outcomes look equal; the user asked for one consistent row control instead, so a Commitment reads
 * and works like every other row, and `X` remains the one-press route to Broken.
 */
export default function CommitmentRow({
  row, visibleDepth = 0, isSelected, isFocusExempt = false, onSelect, onCycleVerdict, onOpenEditor, onAddTagFilter,
}: Props) {
  const { t } = useTranslation("listView");
  const tagNames = useTagNames();
  const { node } = row;

  // Washed in its aspect's colour, exactly as a Task row is — see `TaskRow`.
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    ...aspectWashStyle(node.color),
    "--row-depth": visibleDepth,
  };

  const indentClass = isRtlText(node.title) ? taskStyles.indentRtl : taskStyles.indentLtr;

  return (
    <div
      className={`${taskStyles.card} ${indentClass}${isSelected ? ` ${taskStyles.cardSelected}` : ""}${isFocusExempt ? ` ${taskStyles.cardFocusExempt}` : ""}`}
      // Same marker the task rows carry, so a selected Commitment is scrolled into view by the
      // same code.
      data-row-id={node.id}
      style={cardStyle}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <button
        type="button"
        className={taskStyles.statusButton}
        aria-label={t("cycleVerdict")}
        onClick={(e) => { e.stopPropagation(); onSelect(node.id); onCycleVerdict(node.id); }}
      >
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
          <CommitmentIcon
            cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--text-primary)" opacity={1}
            state={commitmentGlyphState(node.verdict, node.archived === true)}
          />
        </svg>
      </button>

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
