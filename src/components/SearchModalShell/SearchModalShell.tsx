import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./SearchModalShell.module.css";

/** The close button's glyph; its accessible name is the translated "Close". */
const CLOSE_GLYPH = "✕";

interface Props {
  /** The dialog's accessible name. */
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
  /** The listbox the box drives and its highlighted option, when there is one. */
  listId?: string;
  activeOptionId?: string;
  children: ReactNode;
}

/**
 * The look and frame the app's search modals share — `Ctrl+O`'s node search and `Ctrl+F`'s filter
 * search: a dimmed overlay that closes on a click outside, and a panel with one focused search box
 * above whatever results the modal draws.
 *
 * Every way out works on a phone, which has no Escape key: a tap outside, the close button (drawn in
 * the phone layout) and Android's back, which delivers an Escape to the top dialog
 * (`dismissTopSheet`) — so the dialog itself answers an Escape aimed at it, not only the box does.
 */
export default function SearchModalShell({
  label, placeholder, query, onQueryChange, onKeyDown, onClose, listId, activeOptionId, children,
}: Props) {
  const { t } = useTranslation("touch");
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); }}
        // An Escape typed in the box is the modal's own to answer (it may close more, or less); one
        // aimed at the dialog is the system back's.
        onKeyDown={(e) => { if (e.key === "Escape" && e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
      >
        <div className={styles.head}>
          <input
            autoFocus
            type="text"
            className={styles.input}
            placeholder={placeholder}
            aria-label={label}
            value={query}
            autoComplete="off"
            spellCheck={false}
            {...(listId === undefined ? {} : { role: "combobox", "aria-expanded": true, "aria-controls": listId, "aria-autocomplete": "list" as const })}
            {...(activeOptionId === undefined ? {} : { "aria-activedescendant": activeOptionId })}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className={styles.close} aria-label={t("sheetClose")} onClick={onClose}>{CLOSE_GLYPH}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
