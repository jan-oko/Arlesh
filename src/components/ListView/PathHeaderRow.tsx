import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import styles from "./PathHeaderRow.module.css";

interface Props {
  segments: readonly MindmapNode[];
  onEnterSubtree: (id: string) => void;
}

/** The location of the run of rows beneath it — `Growth › CODE › ARLESH › Features` — named once
 * rather than repeated on every card. Carries every ancestor not rendered as a row above the task
 * (SPEC List View: always through to the Goal, including any ancestor Task the filter hides), so it
 * and the rows' indentation never say the same thing twice. Clicking a segment enters it as the
 * subtree — the same re-rooting Ctrl+O performs, shared with the Mindmap — rather than filtering. */
export default function PathHeaderRow({ segments, onEnterSubtree }: Props) {
  const { t } = useTranslation("listView");
  return (
    <div className={styles.header}>
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
