import { useTranslation } from "react-i18next";
import type { Reconcile } from "@/api/flows";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  /** What would be lost, in words: the editor's own sentence. */
  message: string;
  onChoose: (choice: Reconcile) => void;
  onCancel: () => void;
}

/**
 * The question a Habit edit asks before it would orphan recorded iterations: **Archive & new**
 * (the edit lands on a fork, the original keeps its history) or **Discard & regenerate** (the
 * recorded edits are cleared). One prompt, shared by the Habit editor and the flow-item editor,
 * so the same collision reads the same way wherever it is met.
 */
export default function ReconcilePrompt({ message, onChoose, onCancel }: Props) {
  const { t } = useTranslation("editor");
  return (
    <div className={styles.label}>
      <span className={styles.depKind}>{message}</span>
      <div className={styles.statusPills}>
        <button type="button" className={styles.statusPill} onClick={() => onChoose("fork")}>
          {t("reconcileFork")}
        </button>
        <button type="button" className={styles.statusPill} onClick={() => onChoose("discard")}>
          {t("reconcileDiscard")}
        </button>
        <button type="button" className={styles.statusPill} onClick={onCancel}>
          {t("reconcileCancel")}
        </button>
      </div>
    </div>
  );
}
