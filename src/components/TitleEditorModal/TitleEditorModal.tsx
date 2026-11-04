import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import ArchivedField from "@/components/EditorModal/ArchivedField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

/** What the Domain and Tag editor saves. */
export interface SimpleSaveData {
  title: string;
  isPrivate: boolean;
  archived: boolean | undefined;
}

interface Props {
  heading: string;
  title: string;
  isPrivate?: boolean;
  /** Its archive, for a node that takes one — a Domain (Task bd3). Left out, the editor offers no
   * Archived switch and saves `undefined` in its place. */
  archived?: boolean;
  onSave: (title: string, isPrivate: boolean, archived: boolean | undefined) => Promise<void>;
  /** A Save the server refused: the editor opens again on what was typed, with the reason on its error line. */
  reopened?: { draft: SimpleSaveData; error: string } | undefined;
  onClose: () => void;
}

export default function TitleEditorModal({ heading, title: initialTitle, isPrivate: initialIsPrivate, archived: initialArchived, onSave, reopened, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const draft = reopened?.draft;
  const [title, setTitle] = useState(draft?.title ?? initialTitle);
  const [isPrivate, setIsPrivate] = useState(draft?.isPrivate ?? initialIsPrivate ?? false);
  const [archived, setArchived] = useState(draft ? draft.archived : initialArchived);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(reopened?.error ?? null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(title.trim(), isPrivate, archived);
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  return (
    <EditorModal
      heading={heading}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void handleSave()}
      saveError={saveError}
    >
      <label className={styles.label}>
        {t("fieldTitle")}
        <input
          ref={titleRef}
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          type="text"
        />
      </label>
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} startOpen={initialArchived === true}>
        {archived !== undefined && <ArchivedField checked={archived} onChange={setArchived} />}
      </EditorAdvanced>
    </EditorModal>
  );
}
