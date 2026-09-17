import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import styles from "./PathHeaderRow.module.css";

interface Props {
  segments: readonly MindmapNode[];
  onAddAntecedentFilter: (ref: string) => void;
}

/** The location of the run of rows beneath it — `Growth › CODE › ARLESH › Features` — named once
 * rather than repeated on every card. Carries every ancestor not rendered as a row above the task
 * (SPEC List View: always through to the Goal, including any ancestor Task the filter hides), so it
 * and the rows' indentation never say the same thing twice. Clicking a segment adds it as an
 * Antecedent filter, which catches everything beneath it rather than only its direct children. */
export default function PathHeaderRow({ segments, onAddAntecedentFilter }: Props) {
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
            title={t("filterByAntecedent")}
            onClick={() => onAddAntecedentFilter(segment.id)}
          >
            {segment.title}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
