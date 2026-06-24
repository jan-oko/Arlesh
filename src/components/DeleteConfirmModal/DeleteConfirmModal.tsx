import { useTranslation } from "react-i18next";
import styles from "./DeleteConfirmModal.module.css";

interface Props {
  nodeTitle: string;
  descendantCount: number;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ nodeTitle, descendantCount, isDeleting, error, onConfirm, onCancel }: Props) {
  const { t } = useTranslation(["warnings", "common"]);
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => { e.stopPropagation(); }}>
        <h2 className={styles.heading}>{t("warnings:deleteHeading", { title: nodeTitle })}</h2>
        {descendantCount > 0 && (
          <p className={styles.body}>{t("warnings:deleteWithChildren", { count: descendantCount })}</p>
        )}
        {error !== null && <p className={styles.error}>{t("warnings:deleteFailed", { message: error })}</p>}
        <div className={styles.actions}>
          <button autoFocus className={styles.cancelBtn} onClick={onCancel} disabled={isDeleting}>
            {t("common:cancel")}
          </button>
          <button className={styles.deleteBtn} onClick={onConfirm} disabled={isDeleting}>
            {t("warnings:deleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
