import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./BottomSheet.module.css";

/** The close button's glyph; its accessible name is the translated "Close". */
const CLOSE_GLYPH = "✕";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A sheet that rises from the bottom of the screen over a dimmed backdrop: the phone layout's form
 * for a menu or a picker (`docs/spec/touch.md`). A tap on the backdrop, the close button or Escape
 * dismisses it.
 *
 * It does not capture the keyboard (`useInputCapture`): the command palette is one, and the
 * bindings it lists have to stay live while it is open, since running one is what it is for.
 */
export default function BottomSheet({ title, onClose, children }: Props) {
  const { t } = useTranslation("touch");
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Into the sheet, so Escape reaches it; a field inside that wants the focus takes it after.
    sheetRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.grab} aria-hidden="true" />
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label={t("sheetClose")} onClick={onClose}>{CLOSE_GLYPH}</button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
