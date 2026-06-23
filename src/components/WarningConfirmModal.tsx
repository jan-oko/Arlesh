import styles from "./WarningConfirmModal.module.css";

export interface WarningAction {
  label: string;
  variant: "primary" | "danger";
  onClick: () => void;
}

interface Props {
  heading: string;
  consequences: string[];
  actions: WarningAction[];
  onCancel: () => void;
}

export default function WarningConfirmModal({ heading, consequences, actions, onCancel }: Props) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => { e.stopPropagation(); }}>
        <h2 className={styles.heading}>{heading}</h2>
        <ul className={styles.consequences}>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          {actions.map((action, i) => (
            <button
              key={i}
              className={action.variant === "danger" ? styles.dangerBtn : styles.primaryBtn}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
