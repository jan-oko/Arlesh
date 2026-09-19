import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./EditorModal.module.css";

interface Props {
  heading: string;
  onClose: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isSaving: boolean;
  onSave: () => void;
  saveError: string | null;
  /**
   * Set to `"cancel"` to put opening focus on the Cancel button.
   *
   * Escape is handled by `onKeyDown` on the dialog below, which only fires while focus is already
   * inside the dialog — so an editor that claims no focus when it opens cannot be dismissed until
   * the user tabs or clicks into it first. Editors with a title field focus that field themselves
   * and need nothing here. An editor built as a confirmation has no such field, and pointing
   * opening focus at its own confirm would arm a destructive action on the first keypress, so it
   * lands on Cancel instead — the same reasoning as `WarningConfirmModal`, whose prompt exists to
   * be read before it is answered.
   */
  focusOnOpen?: "cancel";
  children: ReactNode;
}

export default function EditorModal({ heading, onClose, onKeyDown, isSaving, onSave, saveError, focusOnOpen, children }: Props) {
  const { t } = useTranslation("common");
  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={styles.modal}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className={styles.heading}>{heading}</h2>
        {children}
        {saveError !== null && <p className={styles.errorMsg}>{saveError}</p>}
        <div className={styles.actions}>
          <button
            autoFocus={focusOnOpen === "cancel"}
            className={styles.cancelBtn}
            type="button"
            onClick={onClose}
            disabled={isSaving}
          >
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
