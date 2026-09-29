import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { useAnchoredPosition } from "@/hooks/use-anchored-position";
import { useInputCapture } from "@/hooks/use-input-capture";
import type { QuickDependencyTarget } from "@/hooks/use-quick-dependency";
import { matchCandidates } from "@/utils/dependency-candidates";
import type { DependencyCandidate } from "@/utils/dependency-candidates";
import { disambiguations } from "@/utils/search-disambiguation";
import styles from "./QuickDependencyPicker.module.css";

/** A small bar, not a modal: a handful of matches is what fits beside the selection. */
const MAX_RESULTS = 8;

interface Props {
  target: QuickDependencyTarget;
  /** The attribute the view marks each drawn node with — `data-node-id`, `data-row-id`, … */
  anchorAttribute: string;
  /** Makes the Task depend on the pick. */
  onPick: (candidate: DependencyCandidate) => void;
  /** Closes without writing. */
  onClose: () => void;
}

/**
 * The `D` quick picker: a small search bar drawn at the selected Task, offering the Tasks, Goals
 * and Expectations it may be made to depend on.
 *
 * It searches as `Ctrl+O` does — nothing until you type, titles in any case, a shared title told
 * apart by its parent path. **↑ ↓** move the highlight, **Enter** or a click adds the highlighted
 * one, **Esc** or a click outside closes and writes nothing. It holds the keyboard while it is
 * open, so the view's own letters stay quiet.
 */
export default function QuickDependencyPicker({ target, anchorAttribute, onPick, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "common", "nodeKinds"]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => matchCandidates(target.candidates ?? [], query, MAX_RESULTS),
    [target.candidates, query],
  );
  const details = useMemo(() => disambiguations(results), [results]);
  const highlighted = Math.min(active, Math.max(0, results.length - 1));
  const position = useAnchoredPosition(ref, anchorAttribute, target.anchorId, String(results.length));

  // Esc closes wherever the focus is, and a click outside closes: nothing is picked until Enter.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const inside = event.target instanceof Node && ref.current !== null && ref.current.contains(event.target);
      if (!inside) onClose();
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  function pick(index: number) {
    const candidate = results[index];
    if (candidate !== undefined) onPick(candidate);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(highlighted + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(highlighted - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(highlighted);
    }
  }

  const hasQuery = query.trim() !== "";
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div
      ref={ref}
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label={t("editor:quickDependencyPicker")}
    >
      <span className={styles.heading}>{t("editor:quickDependencyHeading", { title: target.dependent.title })}</span>
      <input
        autoFocus
        type="text"
        className={styles.input}
        placeholder={t("editor:quickDependencyPlaceholder")}
        aria-label={t("editor:quickDependencyPlaceholder")}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(results.length > 0 ? { "aria-activedescendant": optionId(highlighted) } : {})}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={onInputKeyDown}
      />
      {hasQuery && target.candidates === null && <div className={styles.empty}>{t("editor:quickDependencyLoading")}</div>}
      {hasQuery && target.candidates !== null && results.length === 0 && (
        <div className={styles.empty}>{t("common:noResults")}</div>
      )}
      <ul id={listId} role="listbox" className={styles.results} hidden={results.length === 0}>
        {results.map((candidate, index) => {
          const detail = details.get(candidate.id);
          return (
            <li
              key={candidate.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === highlighted}
              className={`${styles.result}${index === highlighted ? ` ${styles.active}` : ""}`}
              onMouseDown={(event) => { event.preventDefault(); pick(index); }}
              onMouseEnter={() => setActive(index)}
            >
              <span className={styles.label}>
                <span className={styles.title}>{candidate.title}</span>
                {detail !== undefined && detail !== "" && <span className={styles.parentPath}>({detail})</span>}
              </span>
              <span className={styles.kind}>{t(`nodeKinds:${candidate.kind}`)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
