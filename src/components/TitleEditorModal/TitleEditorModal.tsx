import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  heading: string;
  title: string;
  isPrivate?: boolean;
  onSave: (title: string, isPrivate: boolean) => Promise<void>;
  onClose: () => void;
}

export default function TitleEditorModal({ heading, title: initialTitle, isPrivate: initialIsPrivate, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const [title, setTitle] = useState(initialTitle);
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
      await onSave(title.trim(), isPrivate);
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
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
