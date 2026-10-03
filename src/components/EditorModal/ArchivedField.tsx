import { useTranslation } from "react-i18next";
import Switch from "@/components/Switch/Switch";
import styles from "./EditorModal.module.css";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The **Archived** switch under Advanced (Task 269): the hand archive of a stored Task or
 * Commitment. On, the node is put away with everything beneath it; off, it is Live again and its
 * subtree comes back as it was. Saved with the rest of the form, so it is one undo step.
 */
export default function ArchivedField({ checked, onChange }: Props) {
  const { t } = useTranslation("editor");
  return (
    <div className={styles.label}>
      {t("fieldArchived")}
      <Switch checked={checked} onChange={onChange} label={checked ? t("archivedOn") : t("archivedOff")} />
    </div>
  );
}
