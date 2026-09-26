import type { KeyboardEvent, ReactNode } from "react";
import styles from "./SearchModalShell.module.css";

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
 */
export default function SearchModalShell({
  label, placeholder, query, onQueryChange, onKeyDown, onClose, listId, activeOptionId, children,
}: Props) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-label={label} onClick={(e) => { e.stopPropagation(); }}>
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
        {children}
      </div>
    </div>
  );
}
