import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { DIMMED_OPACITY, aspectWashStyle } from "@/utils/node-visuals";
import {
  bulletCapacity, glyphNamesKind, infoBullets, infoChildTitles, stepCardFields, type StepChildCounts,
} from "@/utils/steps-card";
import { isRtlText } from "@/utils/text-direction";
import { useInputCapture } from "@/hooks/use-input-capture";
import AspectIcon from "@/components/NodeIcon/AspectIcon";
import NodeIcon from "@/components/NodeIcon/NodeIcon";
import TaskRowBadges from "@/components/ListView/TaskRowBadges";
import StepCardFields from "./StepCardFields";
import styles from "./StepCard.module.css";

const ICON_R = 9;

interface Props {
  /** The node this card stands for, or `null` for the board's own header card at the true root. */
  node: MindmapNode | null;
  /** The colour of the aspect this card lives under; the fill is mixed from it. `undefined` outside
   * any aspect, which leaves the card the theme's own background. */
  aspectColor: string | undefined;
  /** The card's drawn height in pixels — what decides how many Info bullets fit under its fields. */
  cardHeight: number;
  /** Whether this is the card for the Step you are standing on, drawn above its children. */
  isHeader: boolean;
  isSelected: boolean;
  /** What descending will show, against what the board holds — `null` on a card that holds none. */
  counts: StepChildCounts | null;
  onSelect: () => void;
  onDescend: () => void;
  onOpenEditor: () => void;
  /** Whether the title is open for naming — a card just created, as on the other views. */
  isEditingTitle: boolean;
  onCommitTitle: (title: string) => void;
  onCancelTitleEdit: () => void;
}

/**
 * One card on a Step: the node's glyph, its title, the badges it carries on the Mindmap, the fields
 * you would open the editor to read, its first Info notes, and how many children it holds.
 *
 * **The fill is the node's aspect** — a low-chroma surface mixed from its colour, not the colour
 * itself. That distinction is the whole of what makes it legible: painting the colour on directly
 * is what drew an Aspect's own card at full strength with body text over it. See the stylesheet for
 * the guarantee the mix gives. There is no separate edge bar any more; the card is the signal.
 *
 * **The header card reads as visibly different from a child card**, and it has to: it is the first
 * cell of the same arrow grid, so `↑` from the top row changes *what you are standing on* rather
 * than *what you are choosing*. Its **full width** against a row of fixed-width cards is what says
 * so, with no accent border or label needed to spell it out.
 *
 * **At the true root the header card is the board, and says only its name.** There is no node
 * behind it, so there is nothing true to put under the title — a strapline explaining that would be
 * chrome, and a child count there is the one number on the board nobody is deciding anything from.
 * The *behaviour* is unchanged: every gesture that would act on a node is refused out loud there.
 *
 * Badges and glyph are **reused, not re-derived**: `deriveStatusIndicators` and `NodeIcon` are the
 * shared ones, so a node's state reads the same whichever surface you meet it on — which is what
 * lets the fill spend itself on where the node lives instead.
 */
export default function StepCard({
  node, aspectColor, cardHeight, isHeader, isSelected, counts, onSelect, onDescend, onOpenEditor,
  isEditingTitle, onCommitTitle, onCancelTitleEdit,
}: Props) {
  const { t } = useTranslation(["stepsView", "nodeKinds"]);
  // The title input holds the keyboard while it is open, as the List View's and the Mindmap's do.
  useInputCapture(isEditingTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isEditingTitle) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

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
        <span className={styles.boardTitle}>{t("stepsView:boardTitle")}</span>
      </div>
    );
  }

  const indicators = deriveStatusIndicators(node);
  const fields = stepCardFields(node);
  const bullets = infoBullets(infoChildTitles(node), bulletCapacity(cardHeight, fields.length));
  const cardStyle: CSSProperties & Record<`--${string}`, string | number> = {
    ...aspectWashStyle(aspectColor),
    opacity: node.archived === true ? DIMMED_OPACITY : 1,
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
            {/* Every card has a glyph, an Aspect's included — the kind line is gone wherever the
                glyph already says the kind, so a card without one would say nothing about it. */}
            {node.kind === "aspect" ? (
              <AspectIcon cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--node-text)" opacity={1} />
            ) : (
              <NodeIcon
                kind={node.kind} status={node.status} verdict={node.verdict}
                isArchived={node.archived === true} isBlocked={isNodeBlocked(node)}
                isHabit={node.flow?.isHabit === true}
                cx={ICON_R} cy={ICON_R} r={ICON_R * 0.9} color="var(--node-text)" opacity={1}
              />
            )}
          </svg>
        </span>
        {isEditingTitle ? (
          <input
            ref={inputRef}
            type="text"
            className={styles.titleInput}
            defaultValue={node.title}
            aria-label={t("stepsView:titleLabel")}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); onCommitTitle(event.currentTarget.value); }
              if (event.key === "Escape") { event.stopPropagation(); onCancelTitleEdit(); }
            }}
            onBlur={(event) => onCommitTitle(event.currentTarget.value)}
          />
        ) : (
          <span className={styles.title} dir={isRtlText(node.title) ? "rtl" : "ltr"}>{node.title}</span>
        )}
      </span>

      {/* The kind in words only where the glyph does not already say it. */}
      {!glyphNamesKind(node.kind) && <span className={styles.kind}>{t(`nodeKinds:${node.kind}`)}</span>}
      <TaskRowBadges node={node} indicators={indicators} />
      <StepCardFields node={node} fields={fields} />

      {(bullets.shown.length > 0 || bullets.more > 0) && (
        <ul className={styles.notes}>
          {bullets.shown.map((title, index) => (
            <li key={`${index}-${title}`} className={styles.note}>{title}</li>
          ))}
          {bullets.more > 0 && (
            <li className={`${styles.note} ${styles.noteMore}`}>
              {t("stepsView:moreNotes", { count: bullets.more })}
            </li>
          )}
        </ul>
      )}

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
