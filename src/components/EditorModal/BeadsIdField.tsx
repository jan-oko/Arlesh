import { useTranslation } from "react-i18next";
import styles from "./EditorModal.module.css";

interface Props {
  /** The `bd` issue this node is tracked as, or `undefined` when it is tracked as none. */
  beadsId: string | undefined;
  /** True once the drop is staged: the row reads as gone, though nothing is written until Save. */
  isCleared?: boolean;
  /** Stages the drop, for the editor's Save to perform. Absent where no clear is on offer,
   * and the row is then read-only through and through. */
  onClear?: (() => void) | undefined;
}

/**
 * The **bd issue** row in the Task, Goal, Commitment and Project editors — read-only but for its ×.
 *
 * The id itself cannot be typed or edited here: it is a value `bd` issued and the MCP server is
 * its only source, so it is shown as plain text rather than in an input. Clearing is the one
 * exception, because dropping a link needs no id — a closed, wrong or duplicated issue can be
 * unlinked without a round trip through an agent.
 *
 * The × takes no confirmation, but it does not write either: it **stages** the clear, which the
 * editor's Save performs along with the rest of the form and Cancel or Escape discards along with
 * it. The row then **stays, greyed, for the life of the editor** rather than vanishing — a dialog
 * that reflows under the pointer hides the very thing it is reporting. Reopening the editor after a
 * save shows no row at all, which is the steady state.
 *
 * Nothing is reported here when a clear is refused: it is refused during the save, and the editor's
 * own error line says so, with the row still greyed and the editor still open — a staged clear that
 * did not land is still staged, and pressing Save again retries it.
 *
 * A node with no link renders **nothing at all**: no label, no placeholder.
 */
export default function BeadsIdField({ beadsId, isCleared = false, onClear }: Props) {
  const { t } = useTranslation("editor");

  if (beadsId === undefined || beadsId.trim() === "") return null;

  return (
    <div className={styles.label}>
      {t("fieldBeadsId")}
      <span className={styles.readOnlyRow}>
        <span
          className={`${styles.readOnlyValue}${isCleared ? ` ${styles.readOnlyValueCleared}` : ""}`}
        >
          {beadsId}
        </span>
        {onClear !== undefined && !isCleared && (
          <button
            type="button"
            className={styles.depRemoveBtn}
            aria-label={t("clearBeadsId")}
            onClick={onClear}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}
