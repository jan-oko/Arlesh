import { useTranslation } from "react-i18next";
import { useRowKindToggle } from "@/hooks/use-row-kind-toggle";
import type { ListRowKind } from "@/utils/list-filter";
import styles from "./FilterPopover.module.css";

/**
 * The row-kind selector at the top of the switch block: which of Tasks, Commitments and
 * Expectations the List View draws, or which of its two strips the Zen View draws (see
 * `useRowKindToggle`).
 *
 * A toggle that would be refused is drawn disabled, with the reason as its tooltip, rather than
 * clickable and inert — the List View's last kind still shown, or every kind while its Expectations
 * option (a kind choice of its own) is selected.
 */
export default function RowKindSelector() {
  const { t } = useTranslation("listView");
  const rowKinds = useRowKindToggle();

  function tooltip(kind: ListRowKind): string {
    const refusal = rowKinds.refusal(kind);
    if (refusal !== null) return t(`rowKindRefused.${refusal}`);
    return t("rowKindTooltip", { kind: t(`rowKind.${kind}`) });
  }

  return (
    <div className={styles.pills} role="group" aria-label={t("rowKindsLabel")}>
      {rowKinds.kinds.map((kind) => {
        const shown = rowKinds.isShown(kind);
        return (
          <button
            key={kind}
            type="button"
            className={`${styles.typePill}${shown ? ` ${styles.typePillActive}` : ""}`}
            aria-pressed={shown}
            disabled={rowKinds.refusal(kind) !== null}
            title={tooltip(kind)}
            onClick={() => rowKinds.toggle(kind)}
          >
            {t(`rowKind.${kind}`)}
          </button>
        );
      })}
    </div>
  );
}
