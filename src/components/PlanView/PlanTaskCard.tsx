import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TaskListRow } from "@/utils/list-filter";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { isRtlText } from "@/utils/text-direction";
import TaskIcon from "@/components/NodeIcon/TaskIcon";
import TaskRowBadges from "@/components/ListView/TaskRowBadges";
import styles from "./PlanTaskCard.module.css";

const ICON_R = 9;
const PATH_SEPARATOR = " › ";

interface Props {
  row: TaskListRow;
  isSelected: boolean;
  /** Which way this card moves: into the scope, or back out of it. */
  direction: "in" | "out";
  onSelect: (nodeId: string) => void;
  onMove: (row: TaskListRow) => void;
  onOpenEditor: (nodeId: string) => void;
}

/**
 * One task in a triage pane: where it lives, what it is called, the badges its node carries on the
 * Mindmap, and the one button that moves it across.
 *
 * The **path is on the card**, unlike the List View's, which lifts it into a header above a run of
 * rows. Nothing here is grouped: the two panes are answers to "what could go in" and "what is in",
 * and ordering them by location would be sorting on something neither question asked about. A card
 * that stands alone has to say where it came from itself.
 *
 * It borrows the List View's badge row rather than restating it — the same derivation, the same
 * glyphs, the same tooltips — so a task reads the same whichever surface you meet it on.
 */
export default function PlanTaskCard({ row, isSelected, direction, onSelect, onMove, onOpenEditor }: Props) {
  const { t } = useTranslation("planView");
  const { node } = row;
  const indicators = deriveStatusIndicators(node);
  const { fillColor, fillOpacity } = computeNodeAppearance(node, row.ancestors.length);
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    "--card-tint": fillColor,
    "--card-tint-opacity": fillOpacity,
  };
  const path = row.ancestors.map((ancestor) => ancestor.title).join(PATH_SEPARATOR);
  const moveLabel = direction === "in" ? t("planInto") : t("unplan");

  return (
    <div
      className={`${styles.card}${isSelected ? ` ${styles.cardSelected}` : ""}`}
      data-plan-card-id={node.id}
      style={cardStyle}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpenEditor(node.id)}
    >
      <span className={styles.glyph} aria-hidden="true">
        <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`}>
          <TaskIcon
            cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--text-primary)" opacity={1}
            status={node.status} isBlocked={row.isBlocked}
          />
        </svg>
      </span>
      <span className={styles.body}>
        <span className={styles.path}>{path === "" ? t("noPath") : path}</span>
        <span className={styles.title} dir={isRtlText(node.title) ? "rtl" : "ltr"}>{node.title}</span>
      </span>
      <TaskRowBadges node={node} indicators={indicators} />
      <button
        type="button"
        className={styles.move}
        title={moveLabel}
        aria-label={moveLabel}
        onClick={(event) => { event.stopPropagation(); onMove(row); }}
      >
        {direction === "in" ? "→" : "←"}
      </button>
    </div>
  );
}
