import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FilterDimension } from "@/utils/filter-modes";
import { modeFromModifiers } from "@/utils/filter-modes";
import type { FilterOption } from "@/utils/filter-search";
import type { PillMode } from "@/utils/list-filter";
import type { FilterDimensions } from "@/hooks/use-filter-dimensions";
import type { FilterEntries } from "@/hooks/use-filter-entries";
import ValuePill from "./ValuePill";
import styles from "./FilterPopover.module.css";

interface Props {
  dimension: FilterDimension;
  catalogue: FilterDimensions;
  entries: FilterEntries;
  /** The box's accessible name — the row's label. */
  label: string;
}

const MAX_MATCHES = 30;

/**
 * A searched row — Tags, Under, Depends on: the values already added sit as set pills beside an
 * inline search box. Typing opens a dropdown of the values not yet added; **↑ ↓** move through it,
 * and **Enter** or a click adds with the usual modes (Shift Any, Alt Not). **Esc** clears the query
 * without closing the menu. Removing a set pill from the keyboard moves focus to the next one, or to
 * the box when none is left.
 */
export default function InlineSearch({ dimension, catalogue, entries, label }: Props) {
  const { t } = useTranslation("filter");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  // Where focus goes once a removed set pill has left the row: the pill now at its index.
  const focusAfterRemove = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const added = entries.entries(dimension);
  const addedValues = useMemo(() => new Set(added.map((entry) => entry.value)), [added]);
  const q = query.trim().toLocaleLowerCase();
  const matches = useMemo<FilterOption[]>(
    () => q === ""
      ? []
      : catalogue.options(dimension)
        .filter((option) => !addedValues.has(option.value) && option.label.toLocaleLowerCase().includes(q))
        .slice(0, MAX_MATCHES),
    [catalogue, dimension, addedValues, q],
  );
  const clampedActive = Math.min(active, Math.max(0, matches.length - 1));
  const open = focused && q !== "";

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const pills = rowRef.current?.querySelectorAll<HTMLElement>("[data-set-pill]");
    const next = pills?.[Math.min(index, pills.length - 1)];
    (next ?? inputRef.current)?.focus();
  }, [added]);

  function addOption(option: FilterOption, mode: PillMode) {
    entries.add(dimension, option.value, mode);
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(matches.length - 1, clampedActive + step)));
      return;
    }
    const option = matches[clampedActive];
    if (event.key !== "Enter" || option === undefined) return;
    event.preventDefault();
    addOption(option, modeFromModifiers(event));
  }

  const placeholder = dimension === "tag" ? t("searchTags") : t("searchNodes");
  const noMatch = dimension === "tag" ? t("noTagMatch") : t("noNodeMatch");

  return (
    <div className={styles.searchRow} ref={rowRef}>
      {added.map((entry, index) => (
        <ValuePill
          key={entry.value}
          dimension={dimension}
          label={catalogue.valueLabel(dimension, entry.value, entry.mode)}
          color={catalogue.valueColor(dimension, entry.value)}
          mode={entry.mode}
          onAdd={() => undefined}
          onCycle={() => entries.cycle(dimension, entry.value)}
          onRemove={() => { focusAfterRemove.current = index; entries.remove(dimension, entry.value); }}
        />
      ))}
      <div className={styles.combo}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(open && matches.length > 0 ? { "aria-activedescendant": `${listId}-${clampedActive}` } : {})}
          className={styles.search}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className={styles.menu} role="listbox" id={listId} aria-label={label}>
            {matches.length === 0 && <div className={styles.menuEmpty}>{noMatch}</div>}
            {matches.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === clampedActive}
                className={`${styles.menuItem}${index === clampedActive ? ` ${styles.menuItemActive}` : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={(event) => addOption(option, modeFromModifiers(event))}
              >
                {option.color !== null && <span className={styles.dot} style={{ background: option.color }} aria-hidden="true" />}
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
