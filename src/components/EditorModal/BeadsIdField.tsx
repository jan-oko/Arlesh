import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import styles from "./EditorModal.module.css";

interface Props {
  /** The `bd` issue this node is tracked as, or `undefined` when it is tracked as none. */
  beadsId: string | undefined;
  /** Drops the link. Resolves once it is gone from the database; rejects with the refusal.
   * Absent where no clear is on offer, and the row is then read-only through and through. */
  onClear?: (() => Promise<void>) | undefined;
}

/**
 * The **bd issue** row in the Task, Goal, Commitment and Project editors — read-only but for its ×.
 *
 * The id itself cannot be typed or edited here: it is a value `bd` issued and the MCP server is
 * its only source, so it is shown as plain text rather than in an input. Clearing is the one
 * exception, because dropping a link needs no id — a closed, wrong or duplicated issue can be
 * unlinked without a round trip through an agent.
 *
 * The × acts immediately, with no confirmation: it is one nullable column, the issue is still in
 * `bd` either way, and Ctrl+Z puts it back. The row then **stays, greyed, for the life of the
 * editor** rather than vanishing — a dialog that reflows under the pointer hides the very thing it
 * is reporting. Reopening the editor shows no row at all, which is the steady state.
 *
 * A node with no link renders **nothing at all**: no label, no placeholder.
 */
export default function BeadsIdField({ beadsId, onClear }: Props) {
  const { t } = useTranslation("editor");
  const [isCleared, setIsCleared] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  if (beadsId === undefined || beadsId.trim() === "") return null;

  async function handleClear(clear: () => Promise<void>) {
    setIsClearing(true);
    setClearError(null);
    try {
      await clear();
      setIsCleared(true);
    } catch (error: unknown) {
      // The row stays live and un-greyed: a clear that did not land must not look like one that did.
      setClearError(getErrorMessage(error));
    } finally {
      setIsClearing(false);
    }
  }

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
            disabled={isClearing}
            onClick={() => void handleClear(onClear)}
          >
            ×
          </button>
        )}
      </span>
      {clearError !== null && <span className={styles.errorMsg}>{clearError}</span>}
    </div>
  );
}
