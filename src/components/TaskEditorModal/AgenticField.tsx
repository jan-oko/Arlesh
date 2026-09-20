import { useTranslation } from "react-i18next";
import type { TaskAgentic } from "@/api/tasks";
import { TASK_AGENTIC } from "@/api/tasks";
import styles from "@/components/EditorModal/EditorModal.module.css";

const OPTIONS: TaskAgentic[] = [TASK_AGENTIC.INHERIT, TASK_AGENTIC.YES, TASK_AGENTIC.NO];

const OPTION_LABEL_KEY = {
  [TASK_AGENTIC.INHERIT]: "agenticInherit",
  [TASK_AGENTIC.YES]: "agenticYes",
  [TASK_AGENTIC.NO]: "agenticNo",
} as const;

interface Props {
  value: TaskAgentic;
  /** What **Inherit** currently resolves to: whether anything above this task is agentic. Shown
   * rather than inferred, since Inherit and an explicit "Not agentic" look identical otherwise. */
  inherited: boolean;
  onChange: (value: TaskAgentic) => void;
}

/**
 * The **Agentic** control: whether this task is work an agent could take.
 *
 * Three options rather than a switch, because the flag inherits downward and is overridable — the
 * rule Delegation follows. *Inherit* is the unchosen state and reads the nearest flagged ancestor;
 * the other two are answers of the task's own, and *Not agentic* is a real one, since it is what
 * takes a single task back out of an agentic branch.
 */
export default function AgenticField({ value, inherited, onChange }: Props) {
  const { t } = useTranslation("editor");
  return (
    <div className={styles.label}>
      {t("fieldAgentic")}
      <div className={styles.statusPills}>
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.statusPill}${value === option ? ` ${styles.statusPillActive}` : ""}`}
            onClick={() => onChange(option)}
          >
            {t(OPTION_LABEL_KEY[option])}
          </button>
        ))}
        {/* The one-click delegate button belongs here, beside the flag that earns it. It waits on
            Delegation being able to point at an Agent rather than only a Person (Arlesh-8wh); this
            row is the slot it lands in. */}
      </div>
      {value === TASK_AGENTIC.INHERIT && (
        <small>{inherited ? t("agenticInheritedOn") : t("agenticInheritedOff")}</small>
      )}
    </div>
  );
}
