import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { ExpectationListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { isRtlText } from "@/utils/text-direction";
import ExpectationIcon from "@/components/NodeIcon/ExpectationIcon";
import TaskRowBadges from "./TaskRowBadges";
import taskStyles from "./TaskRow.module.css";

const ICON_R = 10;

interface Props {
  row: ExpectationListRow;
  /** Indentation, when drawn among the task rows; 0 in the band. */
  visibleDepth?: number;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
  /** Releases the wait, or takes a release back. */
  onToggleRelease: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
}

/**
 * One Expectation — a wait — in its band or among the task rows, drawn and worked like a task row:
 * the node's own glyph is the status control, and a click on it releases the wait (or takes the
 * release back), as Enter and `L` do. A delegated Task's wait refuses that out loud: only the Task
 * being done releases it.
 */
export default function ExpectationRow({
  row, visibleDepth = 0, isSelected, onSelect, onToggleRelease, onOpenEditor,
}: Props) {
  const { t } = useTranslation("listView");
  const { node } = row;
  const { fillColor, fillOpacity } = computeNodeAppearance(node, row.ancestors.length);
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    "--card-tint": fillColor,
    "--card-tint-opacity": fillOpacity,
    "--row-depth": visibleDepth,
  };
  const indentClass = isRtlText(node.title) ? taskStyles.indentRtl : taskStyles.indentLtr;

  return (
    <div
      className={`${taskStyles.card} ${indentClass}${isSelected ? ` ${taskStyles.cardSelected}` : ""}`}
      data-row-id={node.id}
      style={cardStyle}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <button
        type="button"
        className={taskStyles.statusButton}
        aria-label={t("releaseToggle")}
        onClick={(e) => { e.stopPropagation(); onSelect(node.id); onToggleRelease(node.id); }}
      >
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`} aria-hidden="true">
          <ExpectationIcon
            cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--text-primary)" opacity={1}
            status={node.status} isArchived={node.archived === true}
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
      </div>
    </div>
  );
}
