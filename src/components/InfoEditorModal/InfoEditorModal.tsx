import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";
import type { MindmapNode } from "@/utils/tree-layout";

/** What the info editor saves: the one-line body and the optional multi-line details. */
export interface InfoSaveData {
  body: string;
  details: string | null;
  nsfw: boolean;
}

interface Props {
  node: MindmapNode;
  onSave: (data: InfoSaveData) => Promise<void>;
  onClose: () => void;
}

/** Edits an info node: its one-line body plus a separate multi-line details field (e.g. a traceback). */
export default function InfoEditorModal({ node, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const [body, setBody] = useState(node.title);
  const [details, setDetails] = useState(node.infoDetails ?? "");
  const [nsfw, setNsfw] = useState(node.nsfw ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
    bodyRef.current?.select();
  }, []);

  async function handleSave() {
    if (body.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ body: body.trim(), details: details.trim() === "" ? null : details, nsfw });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    // Enter saves from the body input; the details textarea keeps Enter for newlines (Ctrl/Cmd+Enter saves).
    if (event.key === "Enter" && (event.target === bodyRef.current || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSave();
    }
    if (event.key === "Escape") onClose();
  }

  return (
    <EditorModal
      heading={t("editInfo")}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      isSaving={isSaving}
      onSave={() => void handleSave()}
      saveError={saveError}
    >
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={bodyRef} className={styles.input} value={body} onChange={(e) => setBody(e.target.value)} type="text" />
      </label>
      <label className={styles.label}>
        {t("fieldDetails")}
        <textarea className={styles.textarea} value={details} onChange={(e) => setDetails(e.target.value)} rows={6} />
      </label>
      <EditorAdvanced nsfw={nsfw} onNsfwChange={setNsfw} />
    </EditorModal>
  );
}
