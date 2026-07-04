import { useTranslation } from "react-i18next";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  reasons: string[];
  onChange: (reasons: string[]) => void;
}

/**
 * Edits a task/goal's ordered list of explicit block reasons — each an inline text row that can be
 * removed, plus an "add" button. (Dependencies contribute further *virtual* blockers, shown via the
 * separate dependencies section; they are not editable here.)
 */
export default function BlockReasonsField({ reasons, onChange }: Props) {
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
      </div>
    </div>
  );
}
