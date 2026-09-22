import { useTranslation } from "react-i18next";
import { useInputCapture } from "@/hooks/use-input-capture";
import type { WarningAction } from "./warning-confirm";
import styles from "./WarningConfirmModal.module.css";

interface Props {
  heading: string;
  consequences: string[];
  actions: WarningAction[];
  onCancel: () => void;
}

/**
 * Every warning prompt in the app is built from this one, so this is where they all claim the
 * keyboard — a token on mount, released on unmount, the mechanism `use-input-capture-store`
 * exists for. The two prompts built on it (backlogging a planned Task, completing an occurrence
 * that still holds work) used to be named as extra conditions in List View's own gating instead,
 * which meant the *global* table could not see them: a chord promoted out of a view would have
 * started firing over an open prompt.
 */
export default function WarningConfirmModal({ heading, consequences, actions, onCancel }: Props) {
  useInputCapture();
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
