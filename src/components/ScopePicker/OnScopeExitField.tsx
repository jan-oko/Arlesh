import { useTranslation } from "react-i18next";
import type { OnScopeExit } from "@/api/scope-lifecycle";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  value: OnScopeExit | null;
  onChange: (value: OnScopeExit) => void;
}

const OPTIONS: OnScopeExit[] = ["keep", "archive"];

/**
 * Archive/Keep choice for a scoped item: what happens once its Time Scope passes unfinished — the
 * item stays (Overdue) or drops from view (Lapsed). Rendered only when the item is explicitly
 * scoped; an unset value shows the Keep default.
 */
export default function OnScopeExitField({ value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const active = value ?? "keep";
  return (
    <div className={styles.statusPills}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.statusPill}${active === option ? ` ${styles.statusPillActive}` : ""}`}
          onClick={() => onChange(option)}
        >
          {t(option === "keep" ? "onScopeExitKeep" : "onScopeExitArchive")}
        </button>
      ))}
    </div>
  );
}
