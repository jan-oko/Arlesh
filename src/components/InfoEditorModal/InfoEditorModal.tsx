import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";
import type { MindmapNode } from "@/utils/tree-layout";

/** What the info editor saves: the one-line body and the optional multi-line details. */
export interface InfoSaveData {
  body: string;
  details: string | null;
  isPrivate: boolean;
}

interface Props {
  node: MindmapNode;
  onSave: (data: InfoSaveData) => Promise<void>;
  /** A Save the server refused: the editor opens again on what was typed, with the reason on its error line. */
  reopened?: { draft: InfoSaveData; error: string } | undefined;
  onClose: () => void;
}

/** Edits an info node: its one-line body plus a separate multi-line details field (e.g. a traceback). */
export default function InfoEditorModal({ node, onSave, reopened, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("editor");
  const draft = reopened?.draft;
  const [body, setBody] = useState(draft?.body ?? node.title);
  const [details, setDetails] = useState(draft ? draft.details ?? "" : node.infoDetails ?? "");
  const [isPrivate, setIsPrivate] = useState(draft?.isPrivate ?? node.isPrivate ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(reopened?.error ?? null);
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
      await onSave({ body: body.trim(), details: details.trim() === "" ? null : details, isPrivate });
    } catch (err) {
      setSaveError(getErrorMessage(err));
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
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate} />
    </EditorModal>
  );
}
