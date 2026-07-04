import { useState } from "react";
import { useTranslation } from "react-i18next";
import EditorModal from "@/components/EditorModal/EditorModal";
import Switch from "@/components/Switch/Switch";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  title: string;
  onConvert: (keepDependencies: boolean, mapScopes: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * Confirms converting a Task/Goal subtree into a Flow — a destructive operation that deletes the
 * original subtree. Toggles whether to keep intra-subtree dependencies and map scopes (both on by
 * default).
 */
export default function ConvertToFlowModal({ title, onConvert, onClose }: Props) {
  const { t } = useTranslation("editor");
  const [keepDependencies, setKeepDependencies] = useState(true);
  const [mapScopes, setMapScopes] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleConvert() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onConvert(keepDependencies, mapScopes);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <EditorModal
      heading={t("convertToFlowHeading", { title })}
      onClose={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      isSaving={isSaving}
      onSave={() => void handleConvert()}
      saveError={saveError}
    >
      <span className={styles.depKind}>{t("convertToFlowWarning")}</span>
      <Switch checked={keepDependencies} onChange={setKeepDependencies} label={t("convertKeepDeps")} />
      <Switch checked={mapScopes} onChange={setMapScopes} label={t("convertMapScopes")} />
    </EditorModal>
  );
}
