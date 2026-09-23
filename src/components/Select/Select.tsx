import { useEffect, useRef, useState } from "react";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./Select.module.css";

const CHEVRON = "▾";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

/** A themed dropdown, fully styled from the app's own tokens (a native `<select>`'s open option list
 * ignores CSS and renders with OS chrome, which reads as a plain white box against the dark theme). */
export default function Select({ value, options, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // An open menu holds the keyboard, exactly as a modal or an inline rename does. Without this its
  // arrow keys reach the board underneath as well — the dispatcher behind the view bindings is a
  // separate window listener, so this component's `preventDefault` never reaches it — and picking
  // an option would quietly walk the selection on the view you were about to leave.
  useInputCapture(open);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  function openMenu() {
    setHighlighted(selectedIndex);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((i) => Math.min(i + 1, options.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const option = options[highlighted];
        if (option !== undefined) {
          onChange(option.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, highlighted, options, onChange]);

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className={styles.value}>{selectedLabel}</span>
        <span className={styles.chevron} aria-hidden="true">{CHEVRON}</span>
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="listbox" aria-label={ariaLabel}>
            {options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${styles.option}${i === highlighted ? ` ${styles.optionHighlighted}` : ""}${option.value === value ? ` ${styles.optionSelected}` : ""}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
