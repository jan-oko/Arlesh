import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "@/components/Switch/Switch";
import styles from "./EditorModal.module.css";

const CHEVRON_OPEN = "▾";
const CHEVRON_CLOSED = "▸";

interface Props {
  isPrivate: boolean;
  onPrivateChange: (checked: boolean) => void;
  /** Kind-specific Advanced controls, rendered above the Private switch every editor shares. */
  children?: ReactNode;
  /** Open on mount although the node is not private — for an editor whose own Advanced control is
   * already engaged, so an active setting is never hidden behind an unopened disclosure. */
  startOpen?: boolean;
}

/**
 * Collapsible **Advanced** section shared by every editor modal — holds the less-common toggles:
 * the Private switch every kind has, plus whatever the editor passes as children (the Task
 * editor's Agentic field). Collapsed by default; auto-opens when the node is private, or when the
 * editor says one of its own Advanced controls is already engaged.
 */
export default function EditorAdvanced({ isPrivate, onPrivateChange, children, startOpen = false }: Props) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(isPrivate || startOpen);
  return (
    <>
      <button type="button" className={styles.advancedToggle} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</span>
        {t("advanced")}
      </button>
      {open && (
        <div className={styles.advancedBody}>
          {children}
          <Switch checked={isPrivate} onChange={onPrivateChange} label={t("markPrivate")} />
        </div>
      )}
    </>
  );
}
