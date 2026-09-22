import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { computeNodeAppearance } from "@/utils/node-visuals";
import { stepCardFields, type StepChildCounts } from "@/utils/steps-card";
import { isRtlText } from "@/utils/text-direction";
import NodeIcon from "@/components/NodeIcon/NodeIcon";
import TaskRowBadges from "@/components/ListView/TaskRowBadges";
import StepCardFields from "./StepCardFields";
import styles from "./StepCard.module.css";

const ICON_R = 9;

interface Props {
  /** The node this card stands for, or `null` for the board's own header card at the true root. */
  node: MindmapNode | null;
  /** How far down the board this card's node sits — the Mindmap's tint depth, so colours match. */
  depth: number;
  /** Whether this is the card for the Step you are standing on, drawn above its children. */
  isHeader: boolean;
  isSelected: boolean;
  /** What descending will show, against what the board holds — `null` on a card that holds none. */
  counts: StepChildCounts | null;
  onSelect: () => void;
  onDescend: () => void;
  onOpenEditor: () => void;
}

/**
 * One card on a Step: the node's glyph, its title, the badges it carries on the Mindmap, the fields
 * you would open the editor to read, and how many children it holds.
 *
 * **The header card reads as visibly different from a child card**, and it has to: it is the first
 * cell of the same arrow grid, so `↑` from the top row changes *what you are standing on* rather
 * than *what you are choosing*. The "you are here" mark and the full-width band are what say so.
 *
 * **At the true root the header card is the board itself.** It carries the tree's own title, no
 * glyph, no badges and no fields, because there is no row behind it — and it says as much in words
 * rather than rendering as an empty form. Every gesture that would act on a node is refused there,
 * out loud, by the view.
 *
 * Badges, tint and glyph are all **reused, not re-derived**: `deriveStatusIndicators`,
 * `computeNodeAppearance` and `NodeIcon` are the Mindmap's own, so a node reads the same whichever
 * surface you meet it on.
 */
export default function StepCard({
  node, depth, isHeader, isSelected, counts, onSelect, onDescend, onOpenEditor,
}: Props) {
  const { t } = useTranslation(["stepsView", "nodeKinds"]);

  const className = [
    styles.card,
    isHeader ? styles.header : styles.child,
    isSelected ? styles.selected : "",
  ].filter((name) => name !== "").join(" ");

  if (node === null) {
    return (
      <div
        className={`${className} ${styles.board}`}
        data-step-card="board"
        aria-current={isSelected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className={styles.top}>
          <span className={styles.title}>{t("stepsView:boardTitle")}</span>
          <span className={styles.here}>{t("stepsView:hereLabel")}</span>
        </span>
        <span className={styles.subtitle}>{t("stepsView:boardSubtitle")}</span>
        {counts !== null && (
          <span className={styles.count}>
            {t("stepsView:childCount", { matching: counts.matching, total: counts.total })}
          </span>
        )}
      </div>
    );
  }

  const appearance = computeNodeAppearance(node, depth);
  const indicators = deriveStatusIndicators(node);
  const fields = stepCardFields(node);
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    "--card-tint": appearance.fillColor,
    "--card-tint-opacity": appearance.fillOpacity,
    opacity: appearance.nodeOpacity,
  };

  return (
    <div
      className={className}
      style={cardStyle}
      data-step-card={node.id}
      aria-current={isSelected ? "true" : undefined}
      onClick={onSelect}
      // Double-click descends rather than opening the editor, which is the one place this view
      // departs from the Mindmap: descending is the gesture Steps exists for, and the editor is one
      // key away on `E`. Inspecting and descending stay different gestures either way.
      onDoubleClick={onDescend}
    >
      <span className={styles.top}>
        <span className={styles.glyph} aria-hidden="true">
          <svg width={ICON_R * 2} height={ICON_R * 2} viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`}>
            <NodeIcon
              kind={node.kind} status={node.status} verdict={node.verdict}
              isArchived={node.archived === true} isBlocked={isNodeBlocked(node)}
              isHabit={node.flow?.isHabit === true}
              cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color={appearance.iconColor}
              opacity={appearance.iconOpacity}
            />
          </svg>
        </span>
        <span className={styles.title} dir={isRtlText(node.title) ? "rtl" : "ltr"}>{node.title}</span>
        {isHeader && <span className={styles.here}>{t("stepsView:hereLabel")}</span>}
      </span>

      <span className={styles.kind}>{t(`nodeKinds:${node.kind}`)}</span>
      <TaskRowBadges node={node} indicators={indicators} />
      <StepCardFields node={node} fields={fields} />

      <span className={styles.footer}>
        {counts !== null && (
          <span className={styles.count}>
            {counts.total === 0
              ? t("stepsView:childCountEmpty")
              : t("stepsView:childCount", { matching: counts.matching, total: counts.total })}
          </span>
        )}
        <button
          type="button"
          className={styles.editBtn}
          title={t("stepsView:openEditor")}
          aria-label={t("stepsView:openEditor")}
          onClick={(event) => { event.stopPropagation(); onOpenEditor(); }}
        >
          {"✎"}
        </button>
      </span>
    </div>
  );
}
