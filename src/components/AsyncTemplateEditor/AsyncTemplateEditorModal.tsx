import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AsyncTemplate } from "@/api/tasks";
import type { Domain } from "@/api/domains";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import { useInputCapture } from "@/hooks/use-input-capture";
import AsyncTemplateFields from "./AsyncTemplateFields";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  taskTitle: string;
  /** The Task's template, or the default a Task that has none starts from. */
  template: AsyncTemplate;
  /** Whether the Task already has a template — only then is there one to remove. */
  hasTemplate: boolean;
  /** Saves the template; `null` makes the Task not asynchronous any more. */
  onSave: (template: AsyncTemplate | null) => Promise<void>;
  onClose: () => void;
  allTags?: Domain[] | undefined;
  domainNames?: Map<number, string> | undefined;
}

/**
 * `Shift+W` on a Task: its **Expectation template**, the wait completing it will spawn. Saving
 * writes the template and nothing else — no Expectation exists until the Task is done. A Task that
 * already has one can drop it here, which makes it not asynchronous any more.
 */
export default function AsyncTemplateEditorModal({ taskTitle, template, hasTemplate, onSave, onClose, allTags, domainNames }: Props) {
  useInputCapture();
  const { t } = useTranslation(["expectation", "common"]);
  const [value, setValue] = useState<AsyncTemplate>(template);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(next: AsyncTemplate | null) {
    if (next !== null && next.title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(next === null ? null : { ...next, title: next.title.trim() });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target instanceof HTMLInputElement && event.target.type === "text") {
      event.preventDefault();
      void save(value);
    }
    if (event.key === "Escape") onClose();
  }

  return (
    <EditorModal
      heading={t("expectation:templateHeading", { title: taskTitle })}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void save(value)}
      saveError={saveError}
    >
      <p className={styles.label}>{t("expectation:templateLead")}</p>
      <AsyncTemplateFields value={value} onChange={setValue} allTags={allTags} domainNames={domainNames} />
      {hasTemplate && (
        <button type="button" className={styles.statusPill} disabled={isSaving} onClick={() => void save(null)}>
          {t("expectation:templateRemove")}
        </button>
      )}
    </EditorModal>
  );
}
