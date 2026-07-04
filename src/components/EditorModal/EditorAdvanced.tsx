import { useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "@/components/Switch/Switch";
import styles from "./EditorModal.module.css";

const CHEVRON_OPEN = "▾";
const CHEVRON_CLOSED = "▸";

interface Props {
  nsfw: boolean;
  onNsfwChange: (checked: boolean) => void;
}

/**
 * Collapsible **Advanced** section shared by every editor modal — holds the less-common toggles
 * (currently the NSFW / Work-mode switch). Collapsed by default; auto-opens when NSFW is set.
 */
export default function EditorAdvanced({ nsfw, onNsfwChange }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(nsfw);
  return (
    <>
      <button type="button" className={styles.advancedToggle} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>
        {t("advanced")}
      </button>
      {open && (
        <div className={styles.advancedBody}>
          <Switch checked={nsfw} onChange={onNsfwChange} label={t("markNsfw")} />
        </div>
      )}
    </>
  );
}
