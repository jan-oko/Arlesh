import { useTranslation } from "react-i18next";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { LIST_ROW_KINDS, rowKindToggleRefusal, type ListRowKind } from "@/utils/list-filter";
import { formatChord } from "@/utils/hotkeys/chord";
import { ROW_KIND_CHORDS } from "@/utils/hotkeys/list/row-kinds";
import PillFilterSection from "./PillFilterSection";
import styles from "./FilterPopover.module.css";

/**
 * The List View's row-kind selector: which of Tasks, Commitments and Expectations the list draws.
 *
 * A toggle that would be refused is drawn disabled, with the reason as its tooltip, rather than
 * clickable and inert — the last kind still shown, or every kind while the Expectations option (a
 * kind choice of its own) is selected.
 */
export default function RowKindSelector() {
  const { t } = useTranslation("listView");
  const listFilter = useListFilterStore((s) => s.filter);
  const toggleKind = useListFilterStore((s) => s.toggleKind);

  function tooltip(kind: ListRowKind): string {
    const refusal = rowKindToggleRefusal(listFilter, kind);
    if (refusal !== null) return t(`rowKindRefused.${refusal}`);
    return t("rowKindTooltip", { kind: t(`rowKind.${kind}`), chord: formatChord(ROW_KIND_CHORDS[kind]) });
  }

  return (
    <PillFilterSection label={t("rowKindsLabel")}>
      <div className={styles.typePills} role="group" aria-label={t("rowKindsLabel")}>
        {LIST_ROW_KINDS.map((kind) => {
          const shown = listFilter.kinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              className={`${styles.typePill}${shown ? ` ${styles.typePillActive}` : ""}`}
              aria-pressed={shown}
              disabled={rowKindToggleRefusal(listFilter, kind) !== null}
              title={tooltip(kind)}
              onClick={() => toggleKind(kind)}
            >
              {t(`rowKind.${kind}`)}
            </button>
          );
        })}
      </div>
    </PillFilterSection>
  );
}
