import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  heading: string;
  title: string;
  nsfw?: boolean;
  onSave: (title: string, nsfw: boolean) => Promise<void>;
  onClose: () => void;
}

export default function TitleEditorModal({ heading, title: initialTitle, nsfw: initialNsfw, onSave, onClose }: Props) {
  const { t } = useTranslation("editor");
  const [title, setTitle] = useState(initialTitle);
  const [nsfw, setNsfw] = useState(initialNsfw ?? false);
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
      await onSave(title.trim(), nsfw);
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
      <EditorAdvanced nsfw={nsfw} onNsfwChange={setNsfw} />
    </EditorModal>
  );
}
