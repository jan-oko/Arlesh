import { useEffect, useRef, useState } from "react";
import EditorModal from "@/components/EditorModal/EditorModal";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  heading: string;
  title: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}

export default function TitleEditorModal({ heading, title: initialTitle, onSave, onClose }: Props) {
  const [title, setTitle] = useState(initialTitle);
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
      await onSave(title.trim());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
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
        Title
        <input
          ref={titleRef}
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          type="text"
        />
      </label>
    </EditorModal>
  );
}
