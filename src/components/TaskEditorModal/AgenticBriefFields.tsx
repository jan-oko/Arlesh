import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { AgenticBrief } from "@/api/tasks";
import { AGENTIC_PRIORITIES } from "@/api/tasks";
import styles from "@/components/EditorModal/EditorModal.module.css";

type BriefText = "spec" | "design" | "acceptance" | "notes";

const TEXT_FIELDS: ReadonlyArray<{ field: BriefText; labelKey: "agenticSpec" | "agenticDesign" | "agenticAcceptance" | "agenticNotes" }> = [
  { field: "spec", labelKey: "agenticSpec" },
  { field: "design", labelKey: "agenticDesign" },
  { field: "acceptance", labelKey: "agenticAcceptance" },
  { field: "notes", labelKey: "agenticNotes" },
];

interface Props {
  value: AgenticBrief;
  onChange: (value: AgenticBrief) => void;
}

/**
 * The **agentic brief** section of the Task editor: what an agent reads about the work, in place of
 * an issue tracker's entry. Shown while the task reads as Agentic, the way the Expectation section
 * follows the Asynchronous switch.
 *
 * Priority is P0–P4 or none; the rest is plain text. **Spec** is flagged as required: a task that
 * reads as Agentic cannot be started without one, and the save that tries is refused out loud.
 */
export default function AgenticBriefFields({ value, onChange }: Props) {
  const { t } = useTranslation("editor");
  const idPrefix = useId();

  return (
    <>
      <div className={styles.label}>
        {t("agenticPriority")}
        <div className={styles.statusPills} role="group" aria-label={t("agenticPriority")}>
          <button
            type="button"
            className={`${styles.statusPill}${value.priority === null ? ` ${styles.statusPillActive}` : ""}`}
            aria-pressed={value.priority === null}
            onClick={() => onChange({ ...value, priority: null })}
          >
            {t("agenticPriorityNone")}
          </button>
          {AGENTIC_PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              className={`${styles.statusPill}${value.priority === priority ? ` ${styles.statusPillActive}` : ""}`}
              aria-pressed={value.priority === priority}
              onClick={() => onChange({ ...value, priority })}
            >
              {t("agenticPriorityValue", { priority })}
            </button>
          ))}
        </div>
      </div>
      {TEXT_FIELDS.map(({ field, labelKey }) => {
        const id = `${idPrefix}-${field}`;
        return (
          <div key={field} className={styles.label}>
            <label htmlFor={id}>{t(labelKey)}</label>
            <textarea
              id={id}
              className={styles.textarea}
              value={value[field]}
              rows={field === "spec" ? 4 : 2}
              {...(field === "spec" ? { placeholder: t("agenticSpecHint"), "aria-required": true } : {})}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
            />
          </div>
        );
      })}
    </>
  );
}
