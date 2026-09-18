import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import NodeIcon from "@/components/NodeIcon/NodeIcon";
import styles from "./PathHeaderRow.module.css";

interface Props {
  segments: readonly MindmapNode[];
  onEnterSubtree: (id: string) => void;
  /** Whether to draw the leading kind glyph — the settings popover's **Path icons** switch. */
  showKindIcon: boolean;
}

/** Sized against the header's `--text-sm`, not against a TaskRow card's larger status icon. */
const ICON_R = 7;

/** The location of the run of rows beneath it — `Growth › CODE › ARLESH › Features` — named once
 * rather than repeated on every card. Carries every ancestor not rendered as a row above the task
 * (SPEC List View: always through to the Goal, including any ancestor Task the filter hides), so it
 * and the rows' indentation never say the same thing twice. Clicking a segment enters it as the
 * subtree — the same re-rooting Ctrl+O performs, shared with the Mindmap — rather than filtering.
 *
 * The header opens with one glyph for the **nearest** ancestor — the node the rows below hang
 * directly from — drawn with the same `NodeIcon` the Mindmap and the task rows use, so one
 * vocabulary covers all three. One glyph, not one per segment: the chain is read for where it ends,
 * and a marker beside every step would compete with the titles it exists to qualify. The glyph can
 * be switched off from the settings popover, leaving the chain as bare titles. */
export default function PathHeaderRow({ segments, onEnterSubtree, showKindIcon }: Props) {
  const { t } = useTranslation("listView");
  const parent = segments[segments.length - 1];
  return (
    <div className={styles.header}>
      {/* An Aspect carries no glyph anywhere in the app — `NodeIcon` returns null for one — so the
          wrapper is skipped rather than reserving an empty box before the chain. */}
      {showKindIcon && parent !== undefined && parent.kind !== "aspect" && (
        <svg
          className={styles.icon}
          width={ICON_R * 2}
          height={ICON_R * 2}
          viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`}
          aria-hidden="true"
        >
          <NodeIcon
            kind={parent.kind}
            status={parent.status}
            isBlocked={isNodeBlocked(parent)}
            isHabit={parent.flow?.isHabit === true}
            cx={ICON_R}
            cy={ICON_R}
            r={ICON_R * 0.9}
            color="currentColor"
            opacity={1}
          />
        </svg>
      )}
      {segments.map((segment, index) => (
        <Fragment key={segment.id}>
          {index > 0 && <span className={styles.separator} aria-hidden="true" />}
          <button
            type="button"
            className={styles.segment}
            dir="auto"
            title={t("enterSubtree")}
            onClick={() => onEnterSubtree(segment.id)}
          >
            {segment.title}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
