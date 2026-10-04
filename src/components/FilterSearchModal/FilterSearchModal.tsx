import { useId, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useFilterDimensions } from "@/hooks/use-filter-dimensions";
import { useFilterEntries } from "@/hooks/use-filter-entries";
import { useFilterSearchGroups } from "@/hooks/use-filter-search-groups";
import { useActiveFilters } from "@/hooks/use-active-filters";
import { useRowKindToggle } from "@/hooks/use-row-kind-toggle";
import { modeFromModifiers } from "@/utils/filter-modes";
import type { ModifierKeys } from "@/utils/filter-modes";
import { searchFilterCatalogue, switchStateAfterPick } from "@/utils/filter-search";
import type { ActiveResult, FilterOption, RowKindResult, SearchResult, SearchSection, SwitchResult } from "@/utils/filter-search";
import { PILL_MODE_SYMBOL } from "@/utils/list-filter";
import { modeColorVar } from "@/utils/pill-color";
import SearchModalShell from "@/components/SearchModalShell/SearchModalShell";
import styles from "./FilterSearchModal.module.css";

/** Whether any node's title contains the query. */
function nodeTitleMatches(nodes: readonly FilterOption[], query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return nodes.some((node) => node.label.toLocaleLowerCase().includes(q));
}

/** A stable key for a result row. */
function resultKey(result: SearchResult): string {
  if (result.kind === "value" || result.kind === "active") return `${result.kind}-${result.dimension}-${result.value}`;
  return `${result.kind}-${result.target}`;
}

interface ModeStyle extends CSSProperties {
  "--pill-mode-color": string;
}

/** An active filter's row: its dimension, its mode symbol in the mode's colour, and its value. */
function ActiveLabel({ result }: { result: ActiveResult }) {
  const { t } = useTranslation("filter");
  const modeStyle: ModeStyle = { "--pill-mode-color": modeColorVar(result.mode) };
  return (
    <span className={styles.label} style={modeStyle} title={t(`tagMode.${result.mode}`)}>
      <span className={styles.prefix}>{t("search.nodePrefix", { dimension: result.dimensionLabel })}</span>
      <span className={styles.symbol} aria-hidden="true">{PILL_MODE_SYMBOL[result.mode]}</span>
      <span className={`${styles.title}${result.mode === "exclude" ? ` ${styles.struck}` : ""}`}>{result.label}</span>
    </span>
  );
}

interface Props {
  onClose: () => void;
}

/**
 * `Ctrl+F`: one "Add filter…" search over every filter the view supports. Nothing is listed until
 * something is typed; a query matches a dimension's name (old names included) or a value's — in the
 * List View every node too, as "Under: X" and "Depends on: X", with its path. **↑ ↓**
 * move, and **Enter** or a click adds — All, **Shift** Any, **Alt** Not — then clears the query and
 * stays open. The switches — the List View's row kinds, Archived, Backlog — are one result each
 * wearing their state; Private is a yes/no pill here, offered while Private Mode is on. The filters
 * already added are listed first, under **Active** — with an empty query too — so they can be
 * changed from here: a pick cycles the mode, Delete removes one (Backspace only edits the query).
 * It edits the same per-tab filter as the Filter menu and the chips.
 */
export default function FilterSearchModal({ onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["filter", "listView"]);
  const listId = useId();
  const view = useViewStore((s) => s.view);
  const rowKinds = useRowKindToggle();
  const setArchivedMode = useFilterStore((s) => s.setArchivedMode);
  const setBacklogMode = useFilterStore((s) => s.setBacklogMode);
  const setDelegatedMode = useFilterStore((s) => s.setDelegatedMode);
  const catalogue = useFilterDimensions();
  const entries = useFilterEntries();
  const groups = useFilterSearchGroups(view, catalogue, entries);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const activeFilters = useActiveFilters(catalogue, entries);
  const q = query.trim().toLocaleLowerCase();
  const activeResults: ActiveResult[] = activeFilters
    .map((filter) => ({ ...filter, kind: "active" as const, matchText: `${filter.dimensionLabel} ${filter.label}` }))
    .filter((result) => q === "" || result.matchText.toLocaleLowerCase().includes(q));
  const activeSection: SearchSection[] = activeResults.length === 0
    ? []
    : [{ key: "active", label: t("search.activeHeading"), searchOnly: false, results: activeResults }];
  const sections = [...activeSection, ...searchFilterCatalogue(groups, query)];
  const results = sections.flatMap((section) => section.results);
  const clampedActive = Math.min(active, Math.max(0, results.length - 1));

  function pickSwitch(result: SwitchResult, keys: ModifierKeys) {
    const next = switchStateAfterPick(result.state, keys);
    if (result.target === "archived") setArchivedMode(next);
    else if (result.target === "backlog") setBacklogMode(next);
    else setDelegatedMode(next);
  }


  function pick(result: SearchResult, keys: ModifierKeys) {
    if (result.kind === "active") { entries.cycle(result.dimension, result.value); return; }
    if (result.kind === "switch") pickSwitch(result, keys);
    else if (result.kind === "rowKind") rowKinds.toggle(result.target);
    else entries.add(result.dimension, result.value, modeFromModifiers(keys));
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(results.length - 1, clampedActive + step)));
      return;
    }
    const result = results[clampedActive];
    // Delete removes the highlighted active filter. Backspace only ever edits the query.
    if (event.key === "Delete" && result?.kind === "active") {
      event.preventDefault();
      entries.remove(result.dimension, result.value);
      return;
    }
    if (event.key !== "Enter" || result === undefined) return;
    event.preventDefault();
    pick(result, event);
  }

  function stateText(result: SwitchResult | RowKindResult): string {
    if (result.kind === "rowKind") return t(result.shown ? "search.rowKindState.shown" : "search.rowKindState.hidden");
    return t(`search.switchState.${result.state}`);
  }

  function stateClass(result: SwitchResult | RowKindResult): string {
    const included = result.kind === "rowKind" ? result.shown : result.state === "include";
    if (included) return `${styles.state} ${styles.stateInclude}`;
    if (result.kind === "switch" && result.state === "exclude") return `${styles.state} ${styles.stateExclude}`;
    return styles.state ?? "";
  }

  // Each section's first option index in the flat list the arrow keys walk.
  const sectionStarts = sections.map((_, position) =>
    sections.slice(0, position).reduce((count, section) => count + section.results.length, 0));
  const hasQuery = query.trim() !== "";
  // Outside the List View there is no node filter; a query naming a node says so rather than
  // answering with nothing (the user may be looking for Ctrl+O's subtree entry).
  const namesNode = hasQuery && view !== "list" && nodeTitleMatches(catalogue.options("antecedent"), query);
  const placeholder = view === "list" ? t("search.placeholder") : t("search.placeholderTags");

  return (
    <SearchModalShell
      label={t("search.dialogLabel")}
      placeholder={placeholder}
      query={query}
      onQueryChange={(next) => { setQuery(next); setActive(0); }}
      onKeyDown={onKeyDown}
      onClose={onClose}
      listId={listId}
      {...(results.length > 0 ? { activeOptionId: `${listId}-${clampedActive}` } : {})}
    >
      {(hasQuery || activeResults.length > 0) && (
        <div className={styles.results} role="listbox" id={listId} aria-label={t("search.dialogLabel")}>
          {sections.map((section, position) => (
            <div key={section.key} role="group" aria-label={section.label}>
              <div className={styles.heading} role="presentation">{section.label}</div>
              {section.results.map((result, offset) => {
                const own = (sectionStarts[position] ?? 0) + offset;
                const isActive = own === clampedActive;
                return (
                  <div
                    key={resultKey(result)}
                    id={`${listId}-${own}`}
                    role="option"
                    aria-selected={isActive}
                    className={`${styles.option}${isActive ? ` ${styles.active}` : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(own)}
                    onClick={(event: MouseEvent) => pick(result, event)}
                  >
                    {result.kind === "active" ? <ActiveLabel result={result} /> : (
                    <span className={styles.label}>
                      {section.searchOnly && <span className={styles.prefix}>{t("search.nodePrefix", { dimension: section.label })}</span>}
                      {result.kind === "value" && result.color !== null && (
                        <span className={styles.dot} style={{ background: result.color }} aria-hidden="true" />
                      )}
                      <span className={styles.title}>{result.label}</span>
                      {result.kind === "value" && result.detail !== null && result.detail !== "" && (
                        <span className={styles.path}>({result.detail})</span>
                      )}
                    </span>
                    )}
                    {(result.kind === "switch" || result.kind === "rowKind") && <span className={stateClass(result)}>{stateText(result)}</span>}
                    {isActive && <kbd className={styles.enter} aria-hidden="true">{t("search.enterKey")}</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {namesNode && <div className={styles.note}>{t("search.nodesListOnly")}</div>}
          {hasQuery && results.length === 0 && !namesNode && <div className={styles.empty}>{t("search.noResults")}</div>}
        </div>
      )}
    </SearchModalShell>
  );
}
