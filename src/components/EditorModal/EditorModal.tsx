import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import styles from "./EditorModal.module.css";

interface Props {
  heading: string;
  onClose: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isSaving: boolean;
  onSave: () => void;
  saveError: string | null;
  children: ReactNode;
}

export default function EditorModal({ heading, onClose, onKeyDown, isSaving, onSave, saveError, children }: Props) {
  const { t } = useTranslation("common");
  // Trapped on the shell, so every editor built on it inherits the trap rather than repeating it.
  const modalRef = useFocusTrap<HTMLDivElement>();
  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className={styles.heading}>{heading}</h2>
        {children}
        {saveError !== null && <p className={styles.errorMsg}>{saveError}</p>}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} type="button" onClick={onClose} disabled={isSaving}>
            {t("cancel")}
          </button>
          <button
            className={styles.saveBtn}
            type="button"
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
