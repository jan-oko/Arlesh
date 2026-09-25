import { useId, useState } from "react";
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

const CHEVRON_CLOSED = "▸";
const CHEVRON_OPEN = "▾";

interface Props {
  value: AgenticBrief;
  onChange: (value: AgenticBrief) => void;
  /** Open on arrival — collapsed otherwise, so the editor can be scrolled past it. */
  startOpen?: boolean;
}

/**
 * The **agentic brief** section of the Task editor: what an agent reads about the work, in place of
 * an issue tracker's entry. Shown while the task reads as Agentic, the way the Expectation section
 * follows the Asynchronous switch.
 *
 * Collapsed by default behind a header that says the priority and whether a Spec is written, so the
 * editor scrolls past it; the header is a button, so it opens from the keyboard like any other.
 *
 * Priority is MW, A, B, C (most urgent first) or none; the rest is plain text. **Spec** is flagged as required: a task that
 * reads as Agentic cannot be started without one, and the save that tries is refused out loud.
 */
export default function AgenticBriefFields({ value, onChange, startOpen = false }: Props) {
  const { t } = useTranslation("editor");
  const idPrefix = useId();
  const [open, setOpen] = useState(startOpen);
  const bodyId = `${idPrefix}-body`;
  // What the collapsed header says: the priority, and whether the one required field is written.
  const summary = [
    value.priority === null ? t("agenticBriefNoPriority") : t("agenticPriorityValue", { priority: value.priority }),
    value.spec.trim() === "" ? t("agenticBriefNoSpec") : t("agenticBriefSpecWritten"),
  ].join(" · ");

  return (
    <>
      <button
        type="button"
        className={styles.advancedToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span aria-hidden="true">{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>
        {t("agenticBriefSection")}
        <span className={styles.depKind}>{summary}</span>
      </button>
      {open && (
        <div id={bodyId} className={styles.advancedBody}>
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
        </div>
      )}
    </>
  );
}
