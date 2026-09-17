import { useTranslation } from "react-i18next";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useInputCapture } from "@/hooks/use-input-capture";
import type { WarningAction } from "./warning-confirm";
import styles from "./WarningConfirmModal.module.css";

interface Props {
  heading: string;
  consequences: string[];
  actions: WarningAction[];
  onCancel: () => void;
}

export default function WarningConfirmModal({ heading, consequences, actions, onCancel }: Props) {
  useInputCapture();
  const modalRef = useFocusTrap<HTMLDivElement>();
  const { t } = useTranslation("common");
  return (
    <div className={styles.overlay} onClick={onCancel}>
      {/* Escape is handled here rather than by the view behind it: the dialog is opened from more
          than one place, and a dismissal that lives in one view's key handler only works there. The
          focus trap is what makes this reliable — focus starts on Cancel and cannot leave. */}
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => { e.stopPropagation(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
      >
        <h2 className={styles.heading}>{heading}</h2>
        <ul className={styles.consequences}>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
        <div className={styles.actions}>
          <button autoFocus className={styles.cancelBtn} onClick={onCancel}>{t("cancel")}</button>
          {actions.map((action, i) => (
            <button key={i} className={action.variant === "danger" ? styles.dangerBtn : styles.primaryBtn} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
