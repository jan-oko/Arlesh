import { useTranslation } from "react-i18next";
import styles from "@/components/EditorModal/EditorModal.module.css";
import { formatCooldownUntil } from "@/utils/cooldown-until";

interface Props {
  reasons: string[];
  onChange: (reasons: string[]) => void;
  /** Derived "Blocked by …" reasons from unmet dependencies — shown read-only, not editable here. */
  virtualBlockers?: string[];
  /** Blocked by the agent capacity lock — shown read-only, removed only by clearing the lock. */
  capacityBlocked?: boolean;
  /** Blocked as a Compound Task whose open sub-items are all blocked — read-only: it goes when a
   * sub-item is unblocked or finished. */
  compoundBlocked?: boolean;
  /** Blocked by its Habit's cooldown until this local instant — read-only: it lifts by itself. */
  coolingUntil?: string | undefined;
}

/**
 * Edits a task/goal's ordered list of explicit block reasons — each an inline text row that can be
 * removed, plus an "add" button. Any **virtual** blockers (from unmet dependencies) follow as
 * immutable rows so the full blocked picture is visible; they're changed by editing the dependencies.
 * The agent capacity lock's reason follows in a group of its own: nothing in the editor changes it.
 */
export default function BlockReasonsField({ reasons, onChange, virtualBlockers = [], capacityBlocked = false, compoundBlocked = false, coolingUntil }: Props) {
  const { t } = useTranslation("editor");
  return (
    <div className={styles.label}>
      {t("fieldBlockReasons")}
      <div className={styles.blockReasonList}>
        {reasons.map((reason, i) => (
          <div key={i} className={styles.blockReasonRow}>
            <input
              className={styles.input}
              value={reason}
              placeholder={t("placeholderBlockReason")}
              onChange={(e) => onChange(reasons.map((r, j) => (j === i ? e.target.value : r)))}
            />
            <button
              type="button"
              className={styles.depRemoveBtn}
              aria-label={t("removeBlockReason")}
              onClick={() => onChange(reasons.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className={styles.addBlockReason} onClick={() => onChange([...reasons, ""])}>
          {t("addBlockReason")}
        </button>
        {virtualBlockers.length > 0 && (
          <div className={styles.virtualBlockers}>
            <span className={styles.virtualBlockersLabel}>{t("virtualBlockersLabel")}</span>
            {virtualBlockers.map((reason, i) => (
              <div key={`v-${i}`} className={styles.virtualBlockerRow}>{reason}</div>
            ))}
          </div>
        )}
        {capacityBlocked && (
          <div className={styles.virtualBlockers}>
            <span className={styles.virtualBlockersLabel}>{t("capacityBlockLabel")}</span>
            <div className={styles.virtualBlockerRow}>{t("agentsAtCapacity")}</div>
          </div>
        )}
        {compoundBlocked && (
          <div className={styles.virtualBlockers}>
            <span className={styles.virtualBlockersLabel}>{t("compoundBlockLabel")}</span>
            <div className={styles.virtualBlockerRow}>{t("compoundBlocked")}</div>
          </div>
        )}
        {coolingUntil !== undefined && (
          <div className={styles.virtualBlockers}>
            <span className={styles.virtualBlockersLabel}>{t("cooldownBlockLabel")}</span>
            <div className={styles.virtualBlockerRow}>{t("cooldownBlocked", { when: formatCooldownUntil(coolingUntil) })}</div>
          </div>
        )}
      </div>
    </div>
  );
}
