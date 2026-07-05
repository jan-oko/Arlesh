import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PillFilter, PillMode } from "@/utils/list-filter";
import styles from "./FilterPopover.module.css";

const NEXT_MODE: Record<PillMode, PillMode> = { any: "all", all: "exclude", exclude: "any" };
/** Set-theory glyphs: Any = union, All = intersection, Exclude = empty set (same convention as tags). */
const MODE_SYMBOL: Record<PillMode, string> = { any: "∪", all: "∩", exclude: "∅" };

interface Props {
  label: string;
  pills: readonly PillFilter[];
  displayName: (value: string) => string;
  onSetMode: (value: string, mode: PillMode) => void;
  onRemove: (value: string) => void;
  /** The control that adds a new pill — a fixed-option button row, or a searchable combobox. */
  addControl?: ReactNode;
}

/** One List-View-exclusive filter section: pills in the same any/all/exclude pattern as tag filters,
 * generalized over any string-valued dimension (parent/antecedent/dependency/statuses/scope/blocked). */
export default function PillFilterSection({ label, pills, displayName, onSetMode, onRemove, addControl }: Props) {
  const { t } = useTranslation("filter");
  return (
    <section className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      {pills.length > 0 && (
        <div className={styles.tagPills}>
          {pills.map((pill) => (
            <span key={pill.value} className={styles.tagPill}>
              <button
                type="button"
                className={`${styles.modeGlyph} ${styles[`mode_${pill.mode}`]}`}
                title={t(`tagMode.${pill.mode}`)}
                aria-label={t(`tagMode.${pill.mode}`)}
                onClick={() => onSetMode(pill.value, NEXT_MODE[pill.mode])}
              >
                {MODE_SYMBOL[pill.mode]}
              </button>
              <span className={styles.tagPillName}>{displayName(pill.value)}</span>
              <button type="button" className={styles.tagPillX} aria-label={t("removeTagFilter")} onClick={() => onRemove(pill.value)}>×</button>
            </span>
          ))}
        </div>
      )}
      {addControl}
    </section>
  );
}
