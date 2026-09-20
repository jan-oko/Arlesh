import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EntityOption } from "@/hooks/use-filter-display";
import styles from "./FilterPopover.module.css";

interface EntityAdderProps {
  placeholder: string;
  available: EntityOption[];
  onAdd: (id: string) => void;
}

/** Searchable, portalled entity picker — the generic form of the tag TagAdder, for any pill dimension
 * whose values are node ids (antecedent / dependency). */
export function EntityAdder({ placeholder, available, onAdd }: EntityAdderProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: r.width });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = available.filter((option) => option.label.toLowerCase().includes(q)).slice(0, 30);

  return (
    <div className={styles.searchWrap}>
      <input
        ref={inputRef}
        type="text"
        className={styles.search}
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && results.length > 0 && pos !== null && createPortal(
        <div className={styles.menu} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>
          {results.map((option) => (
            <div key={option.id} className={styles.menuItem} onMouseDown={(e) => { e.preventDefault(); onAdd(option.id); setQuery(""); }}>
              {option.color !== null && <span className={styles.dot} style={{ background: option.color }} />}
              {option.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

interface FixedValueAdderProps {
  /** Every valid value for this dimension, in display order. */
  values: readonly string[];
  /** Values already added as a pill — hidden from the button row (they render as a pill instead). */
  added: ReadonlySet<string>;
  labelFor: (value: string) => string;
  onAdd: (value: string) => void;
}

/** A row of buttons for a fixed-option dimension (task/goal/project status, scope state, blocked) —
 * clicking an unpicked value adds it as an "any"-mode pill. */
export function FixedValueAdder({ values, added, labelFor, onAdd }: FixedValueAdderProps) {
  const remaining = values.filter((value) => !added.has(value));
  if (remaining.length === 0) return null;
  return (
    <div className={styles.typePills}>
      {remaining.map((value) => (
        <button key={value} type="button" className={styles.typePill} onClick={() => onAdd(value)}>
          {labelFor(value)}
        </button>
      ))}
    </div>
  );
}
