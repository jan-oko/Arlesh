import { useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "@/components/Switch/Switch";
import styles from "./EditorModal.module.css";

const CHEVRON_OPEN = "▾";
const CHEVRON_CLOSED = "▸";

interface Props {
  isPrivate: boolean;
  onPrivateChange: (checked: boolean) => void;
}

/**
 * Collapsible **Advanced** section shared by every editor modal — holds the less-common toggles
 * (currently the Private switch). Collapsed by default; auto-opens when the node is private.
 */
export default function EditorAdvanced({ isPrivate, onPrivateChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(isPrivate);
  return (
    <>
      <button type="button" className={styles.advancedToggle} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>
        {t("advanced")}
      </button>
      {open && (
        <div className={styles.advancedBody}>
          <Switch checked={isPrivate} onChange={onPrivateChange} label={t("markPrivate")} />
        </div>
      )}
    </>
  );
}
