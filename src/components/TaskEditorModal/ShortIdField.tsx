import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./ShortIdField.module.css";

interface Props {
  /** The node's short id on the board — the one the MCP and a "Blocked by …" reason name it by. */
  shortId: string;
}

/** Selects the whole of `element`'s text, so the user can copy it by hand. */
function selectText(element: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The node's **short id**, read-only and selectable, with a button that copies it. Where the
 * clipboard is refused or missing, the button selects the id instead, so it can still be copied by
 * hand.
 */
export default function ShortIdField({ shortId }: Props) {
  const { t } = useTranslation("editor");
  const valueRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  function selectValue() {
    if (valueRef.current !== null) selectText(valueRef.current);
  }

  function copy() {
    // `navigator.clipboard` is absent outside a secure context, whatever its type says.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      selectValue();
      return;
    }
    clipboard.writeText(shortId).then(() => setCopied(true), selectValue);
  }

  return (
    <div role="group" aria-label={t("fieldShortId")} className={styles.field} title={t("shortIdHint")}>
      <span className={styles.label}>{t("fieldShortId")}</span>
      <div className={styles.row}>
        <code ref={valueRef} className={styles.value}>{shortId}</code>
        <button type="button" className={styles.copy} aria-label={t("copyShortId")} onClick={copy}>
          {copied ? t("shortIdCopied") : t("copyShortIdButton")}
        </button>
      </div>
    </div>
  );
}
