import type { CSSProperties, DragEvent, MouseEvent } from "react";
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

/** Which modifiers a click carried — a bare click, a range, or a toggle. */
export interface SelectModifiers {
  shift: boolean;
  ctrl: boolean;
}

interface Props {
  row: TaskListRow;
  isSelected: boolean;
  /**
   * Which way this card moves: into the scope, out of it, or — with the pane split into subscopes
   * — nowhere, because planning into the whole while looking at its parts is the move the split
   * exists to replace. `null` draws no button rather than one that refuses.
   */
  direction: "in" | "out" | null;
  /**
   * Whether the card says where it lives. Off while the pane is grouped by path: the header above
   * the run already names the chain, and a card repeating it under a header that just said it was
   * the duplication that made the line too narrow to read in the first place.
   */
  showPath: boolean;
  onSelect: (nodeId: string, modifiers: SelectModifiers) => void;
  onMove: (row: TaskListRow) => void;
  onOpenEditor: (nodeId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => void;
}

/**
 * One task in a triage pane: where it lives, what it is called, the badges its node carries on the
 * Mindmap, and — where there is one — the button that moves it across.
 *
 * It borrows the List View's badge row rather than restating it — the same derivation, the same
 * glyphs, the same tooltips — so a task reads the same whichever surface you meet it on.
 *
 * **Clicking is selecting**, and `Shift` and `Ctrl` mean here what they mean in every list: a range
 * from the anchor, and one row added or removed. Dragging a card that is already selected drags the
 * whole selection, so the pointer and the keyboard are always talking about the same rows.
 */
export default function PlanTaskCard({
  row, isSelected, direction, showPath, onSelect, onMove, onOpenEditor, onDragStart,
}: Props) {
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

  // `Ctrl` is read together with `Meta` because that is how every other modifier-click in the app
  // reads it; the app runs on Linux, where `Ctrl` is the one that gets pressed.
  function select(event: MouseEvent): void {
    onSelect(node.id, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
  }

  return (
    <div
      className={`${styles.card}${isSelected ? ` ${styles.cardSelected}` : ""}`}
      data-plan-card-id={node.id}
      style={cardStyle}
      draggable
      onDragStart={(event) => onDragStart(event, node.id)}
      onClick={select}
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
        {showPath && <span className={styles.path}>{path === "" ? t("noPath") : path}</span>}
        <span className={styles.title} dir={isRtlText(node.title) ? "rtl" : "ltr"}>{node.title}</span>
      </span>
      <TaskRowBadges node={node} indicators={indicators} />
      {direction !== null && (
        <button
          type="button"
          className={styles.move}
          title={moveLabel}
          aria-label={moveLabel}
          onClick={(event) => { event.stopPropagation(); onMove(row); }}
        >
          {direction === "in" ? "→" : "←"}
        </button>
      )}
    </div>
  );
}
