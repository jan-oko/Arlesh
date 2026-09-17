import { useTranslation } from "react-i18next";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import styles from "./DeleteConfirmModal.module.css";

interface Props {
  nodeTitle: string;
  nodeCount: number;
  descendantCount: number;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ nodeTitle, nodeCount, descendantCount, isDeleting, error, onConfirm, onCancel }: Props) {
  useInputCapture();
  const modalRef = useFocusTrap<HTMLDivElement>();
  const { t } = useTranslation(["warnings", "common"]);
  const heading = nodeCount > 1
    ? t("warnings:deleteMultipleHeading", { count: nodeCount })
    : t("warnings:deleteHeading", { title: nodeTitle });
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div ref={modalRef} className={styles.modal} onClick={(e) => { e.stopPropagation(); }}>
        <h2 className={styles.heading}>{heading}</h2>
        {descendantCount > 0 && (
          <p className={styles.body}>{t("warnings:deleteWithChildren", { count: descendantCount })}</p>
        )}
        {error !== null && <p className={styles.error}>{t("warnings:deleteFailed", { message: error })}</p>}
        <div className={styles.actions}>
        {/* Delete, not Cancel, takes focus: the answer here is known before the modal opens, so
            confirming stays one key. The focus ring keeps the consequence visible. Deliberately
            unlike WarningConfirmModal, whose prompts exist to be read. */}
          <button className={styles.cancelBtn} onClick={onCancel} disabled={isDeleting}>
            {t("common:cancel")}
          </button>
          <button autoFocus className={styles.deleteBtn} onClick={onConfirm} disabled={isDeleting}>
            {t("warnings:deleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
