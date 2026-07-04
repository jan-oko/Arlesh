import { useTranslation } from "react-i18next";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  reasons: string[];
  onChange: (reasons: string[]) => void;
  /** Derived "Blocked by …" reasons from unmet dependencies — shown read-only, not editable here. */
  virtualBlockers?: string[];
}

/**
 * Edits a task/goal's ordered list of explicit block reasons — each an inline text row that can be
 * removed, plus an "add" button. Any **virtual** blockers (from unmet dependencies) follow as
 * immutable rows so the full blocked picture is visible; they're changed by editing the dependencies.
 */
export default function BlockReasonsField({ reasons, onChange, virtualBlockers = [] }: Props) {
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
      </div>
    </div>
  );
}
