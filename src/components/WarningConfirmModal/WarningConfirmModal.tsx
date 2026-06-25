import { useTranslation } from "react-i18next";
import type { WarningAction } from "./warning-confirm";
import styles from "./WarningConfirmModal.module.css";

interface Props {
  heading: string;
  consequences: string[];
  actions: WarningAction[];
  onCancel: () => void;
}

export default function WarningConfirmModal({ heading, consequences, actions, onCancel }: Props) {
  const { t } = useTranslation("common");
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => { e.stopPropagation(); }}>
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
